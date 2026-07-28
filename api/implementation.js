/* Space Control - Experiment API implementation.
 *
 * WebExtension APIs cannot touch the main window UI, so the hiding is done from
 * chrome: one global user stylesheet whose text encodes the current settings,
 * plus a per-window pass that disables keyboard shortcuts and closes tabs that
 * belong to a space that has just been switched off.
 *
 * Element IDs below were read out of omni.ja for Betterbird 140 (Thunderbird
 * 140 ESR). They are checked against the live document at runtime only where
 * we touch nodes from JS; the CSS simply does not match if an ID disappears.
 */

"use strict";

var { ExtensionSupport } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionSupport.sys.mjs"
);

const ADDON_ID = "space-control@davidboulay";
const MAIL_WINDOW = "chrome://messenger/content/messenger.xhtml";

const CHAT_PREF = "mail.chat.enabled";
const IMIP_PREF = "calendar.itip.showImipBar";

/** Spaces the user is allowed to switch off. Mail and Settings always stay. */
const OPTIONAL_SPACES = ["addressbook", "calendar", "tasks", "chat"];

/* The spaces toolbar filters its arrow-key navigation on the hidden attribute
 * rather than on CSS, so these have to be hidden the way Thunderbird itself
 * hides them when chat is off - otherwise keyboard focus lands on an invisible
 * button. Everything else is handled by the stylesheet. */
const HIDDEN_ELEMENTS = {
  addressbook: ["addressBookButton", "spacesPopupButtonAddressBook"],
  calendar: ["calendarButton", "spacesPopupButtonCalendar"],
  tasks: ["tasksButton", "spacesPopupButtonTasks"],
  chat: ["chatButton", "spacesPopupButtonChat"],
};

/* Selectors are qualified with XUL element names or scoped to a chrome
 * container wherever the bare ID could plausibly occur in a web page or
 * message body, because the sheet is registered globally. */
const SELECTORS = {
  addressbook: [
    'li[item-id="address-book"]',
    'li[item-id="create-address-book"]',
    "menuitem#addressBook", // Tools > Address Book
    "menuitem#menu_newCard", // File > New > Contact
    "toolbarbutton#appmenu_newCard",
    "toolbarbutton#appmenu_newAB",
    "toolbarbutton#appmenu_newAccountHubAB",
    "toolbarbutton#appmenu_newABMenuItem",
    "toolbarbutton#appmenu_newCardDAVMenuItem",
    "toolbarbutton#appmenu_newLdapMenuItem",
  ],
  calendar: [
    'li[item-id="calendar"]',
    'li[item-id="add-as-event"]',
    "menu#calCalendarMenu",
    "menu#calTodayPaneMenu",
    "menuitem#calMenuSwitchToCalendar",
    "menuitem#calNewEvent2",
    "menuitem#calendar-new-event-menuitem",
    "menuitem#calendar-new-calendar-menuitem",
    "toolbarbutton#appmenu_calendar-new-event-menu-item",
    "toolbarbutton#appmenu_calendar-new-calendar-menu-item",
    "toolbarbutton#calendar-status-todaypane-button",
    "menuitem#mailContext-calendar-convert-event-menuitem",
    "#today-pane-panel",
    "#today-pane-splitter",
  ],
  tasks: [
    'li[item-id="tasks"]',
    'li[item-id="add-as-task"]',
    "menu#calTasksMenu",
    "menuitem#calMenuSwitchToTask",
    "menuitem#calNewTask2",
    "menuitem#calendar-new-task-menuitem",
    "toolbarbutton#appmenu_calendar-new-task-menu-item",
    "menuitem#mailContext-calendar-convert-task-menuitem",
  ],
  // Chat is really switched off by mail.chat.enabled, which only takes effect
  // at startup. These rules hide it immediately, before that restart.
  chat: [
    'li[item-id="chat"]',
    "toolbarbutton#button-chat",
    "menuitem#menu_goChat",
    "menuseparator#goChatSeparator",
    "menuitem#joinChatMenuItem",
    "menuitem#newIMAccountMenuItem",
    "menuitem#newIMContactMenuItem",
    "toolbarbutton#appmenu_newIMAccountMenuItem",
    "#imAccountsStatus",
  ],
};

/* Only applies when calendar AND tasks are both off, i.e. the whole calendar
 * component is unwanted. Thunderbird already tags every calendar-specific menu
 * item with .hide-when-calendar-deactivated for its own "no calendars enabled"
 * state, so reusing that class covers surfaces we would otherwise miss. */
const CALENDAR_COMPONENT_SELECTORS = [
  ".hide-when-calendar-deactivated",
  "menu#menu_Event_Task",
  "menu#mailContext-calendar-convert-menu",
  "richlistitem#category-calendar", // Settings > Calendar
];

/** <key> elements to disable so shortcuts cannot reach a hidden space. */
const KEYS = {
  addressbook: ["key_addressbook"],
  calendar: ["calendar-new-event-key", "todaypanekey"],
  tasks: ["calendar-new-todo-key"],
  chat: [],
};

/** Tab modes that belong to each space, so restored tabs can be closed. */
const TAB_MODES = {
  addressbook: ["addressBookTab"],
  calendar: ["calendar"],
  tasks: ["tasks"],
  chat: ["chat"],
};

const ALL_KEY_IDS = Object.values(KEYS).flat();
const ALL_HIDDEN_IDS = Object.values(HIDDEN_ELEMENTS).flat();

/** Fill in anything the caller left out; unknown spaces are ignored. */
function normalize(kept) {
  const config = {};
  for (const space of OPTIONAL_SPACES) {
    config[space] = kept?.[space] !== false;
  }
  return config;
}

function buildCss(config) {
  const selectors = [];
  for (const space of OPTIONAL_SPACES) {
    if (!config[space]) {
      selectors.push(...SELECTORS[space]);
    }
  }
  if (!config.calendar && !config.tasks) {
    selectors.push(...CALENDAR_COMPONENT_SELECTORS);
  }
  if (!selectors.length) {
    return null;
  }
  // One rule per selector, not one grouped rule: an invalid selector takes its
  // whole rule down with it, and these IDs are only as current as the
  // Betterbird version they were read from.
  return (
    "/* Space Control */\n" +
    selectors
      .map(selector => `${selector} { display: none !important; }`)
      .join("\n") +
    "\n"
  );
}

const styleSheets = {
  service: Cc["@mozilla.org/content/style-sheet-service;1"].getService(
    Ci.nsIStyleSheetService
  ),
  currentURI: null,

  /** Register `css` as the one sheet this add-on owns, replacing any previous. */
  set(css) {
    const uri = css
      ? Services.io.newURI(
          "data:text/css;charset=utf-8," + encodeURIComponent(css)
        )
      : null;

    if (this.currentURI && (!uri || !this.currentURI.equals(uri))) {
      this.remove();
    }
    if (!uri || this.currentURI) {
      return;
    }
    this.service.loadAndRegisterSheet(uri, this.service.USER_SHEET);
    this.currentURI = uri;
  },

  remove() {
    if (!this.currentURI) {
      return;
    }
    if (
      this.service.sheetRegistered(this.currentURI, this.service.USER_SHEET)
    ) {
      this.service.unregisterSheet(this.currentURI, this.service.USER_SHEET);
    }
    this.currentURI = null;
  },
};

/** Disable or re-enable the shortcut keys of the optional spaces. */
function updateKeys(window, config) {
  for (const space of OPTIONAL_SPACES) {
    for (const id of KEYS[space]) {
      const key = window.document.getElementById(id);
      if (!key) {
        continue;
      }
      if (config[space]) {
        key.removeAttribute("disabled");
      } else {
        key.setAttribute("disabled", "true");
      }
    }
  }
}

/** Hide or show the spaces toolbar buttons and their pinned-menu twins. */
function updateHiddenElements(window, config) {
  for (const space of OPTIONAL_SPACES) {
    for (const id of HIDDEN_ELEMENTS[space]) {
      const element = window.document.getElementById(id);
      if (element) {
        element.hidden = !config[space];
      }
    }
  }
}

/**
 * Put a window back the way we found it.
 *
 * @param {ChromeWindow} window - A mail:3pane window.
 * @param {boolean} chatLoaded - Whether chat initialised at startup. If it did
 *   not, its buttons stay hidden: Thunderbird hides them itself in that case,
 *   and revealing them would only offer a dead space until the next restart.
 */
function restoreWindow(window, chatLoaded) {
  removeToolsMenuItem(window);
  for (const id of ALL_KEY_IDS) {
    window.document.getElementById(id)?.removeAttribute("disabled");
  }
  for (const id of ALL_HIDDEN_IDS) {
    if (!chatLoaded && HIDDEN_ELEMENTS.chat.includes(id)) {
      continue;
    }
    const element = window.document.getElementById(id);
    if (element) {
      element.hidden = false;
    }
  }
}

/** The tab modes that no longer have a space to live in. */
function hiddenTabModes(config) {
  const modes = new Set();
  for (const space of OPTIONAL_SPACES) {
    if (!config[space]) {
      for (const mode of TAB_MODES[space]) {
        modes.add(mode);
      }
    }
  }
  return modes;
}

function closeTab(tabmail, tabInfo) {
  try {
    tabmail.closeTab(tabInfo, true);
  } catch (error) {
    console.warn("Space Control: could not close tab", error);
  }
}

/** Close tabs of hidden spaces that are open right now. */
function closeHiddenTabs(window, config) {
  const tabmail = window.document.getElementById("tabmail");
  const modes = hiddenTabModes(config);
  if (!tabmail || !modes.size) {
    return;
  }
  for (const tabInfo of [...tabmail.tabInfo]) {
    if (modes.has(tabInfo.mode?.name)) {
      closeTab(tabmail, tabInfo);
    }
  }
}

const MENU_ITEM_ID = "spaceControlToolsMenuItem";

/**
 * Add "Space Control" to the Tools menu. Without it the only way in is the
 * Preferences tab of the add-on's detail view in the Add-ons Manager, which is
 * three clicks deep and easy to conclude does not exist.
 *
 * @param {ChromeWindow} window - A mail:3pane window.
 */
function addToolsMenuItem(window) {
  const doc = window.document;
  if (doc.getElementById(MENU_ITEM_ID)) {
    return;
  }
  const anchor = doc.getElementById("addonsManager");
  if (!anchor) {
    return;
  }

  const item = doc.createXULElement("menuitem");
  item.id = MENU_ITEM_ID;
  item.setAttribute("label", "Space Control…");
  item.addEventListener("command", () => {
    const view = `addons://detail/${encodeURIComponent(ADDON_ID)}/preferences`;
    if (typeof window.openAddonsMgr == "function") {
      window.openAddonsMgr(view);
    } else {
      window.openContentTab("about:addons");
    }
  });
  anchor.after(item);
}

function removeToolsMenuItem(window) {
  window.document.getElementById(MENU_ITEM_ID)?.remove();
}

const tabGuards = new WeakMap();

/**
 * Watch a window for tabs of hidden spaces appearing later - session restore
 * races with add-on startup, and other code can open a tab at any time.
 *
 * @param {ChromeWindow} window - A mail:3pane window.
 * @param {Function} getConfig - Returns the current config, or null.
 */
function addTabGuard(window, getConfig) {
  const tabmail = window.document.getElementById("tabmail");
  if (!tabmail || tabGuards.has(window)) {
    return;
  }

  const monitor = {
    monitorName: "spaceControlTabGuard",
    // tabmail calls this one without checking that it exists.
    onTabSwitched() {},
    onTabOpened(tabInfo) {
      const config = getConfig();
      if (!config || !hiddenTabModes(config).has(tabInfo.mode?.name)) {
        return;
      }
      // Deferred: closing a tab from inside tabmail's restore loop confuses it.
      window.setTimeout(() => closeTab(tabmail, tabInfo), 0);
    },
  };

  tabmail.registerTabMonitor(monitor);
  tabGuards.set(window, monitor);
}

function removeTabGuard(window) {
  const monitor = tabGuards.get(window);
  if (!monitor) {
    return;
  }
  window.document.getElementById("tabmail")?.unregisterTabMonitor(monitor);
  tabGuards.delete(window);
}

/**
 * @param {ChromeWindow} window - A mail:3pane window.
 * @param {object} config - Which spaces are kept.
 * @param {boolean} chatLoaded - Whether chat initialised at startup. Turning
 *   chat back on cannot reveal a working chat button before a restart.
 */
function applyToWindow(window, config, chatLoaded) {
  addToolsMenuItem(window);
  updateKeys(window, config);
  updateHiddenElements(window, {
    ...config,
    chat: config.chat && chatLoaded,
  });
  closeHiddenTabs(window, config);
}

function forEachMailWindow(callback) {
  for (const window of Services.wm.getEnumerator("mail:3pane")) {
    if (window.closed) {
      continue;
    }
    try {
      callback(window);
    } catch (error) {
      console.warn("Space Control: window update failed", error);
    }
  }
}

var spaceControl = class extends ExtensionAPI {
  /** mail.chat.enabled as it was when this session started. */
  #initialChatPref = Services.prefs.getBoolPref(CHAT_PREF, true);
  #config = null;
  #listening = false;

  getAPI() {
    return {
      spaceControl: {
        apply: async kept => {
          const config = normalize(kept);
          this.#config = config;

          styleSheets.set(buildCss(config));

          // Chat has a real off switch; the calendar component does not, but
          // suppressing the invitation bar keeps it out of the message pane.
          Services.prefs.setBoolPref(CHAT_PREF, config.chat);
          if (!config.calendar && !config.tasks) {
            Services.prefs.setBoolPref(IMIP_PREF, false);
          } else if (!Services.prefs.getBoolPref(IMIP_PREF, true)) {
            Services.prefs.setBoolPref(IMIP_PREF, true);
          }

          forEachMailWindow(window =>
            applyToWindow(window, config, this.#initialChatPref)
          );
          this.#startListening();

          return { restartRequired: this.#restartRequired() };
        },

        getStatus: async () => ({
          chatEnabled: Services.prefs.getBoolPref(CHAT_PREF, true),
          restartRequired: this.#restartRequired(),
        }),

        restart: async () => {
          Services.startup.quit(
            Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart
          );
        },
      },
    };
  }

  /** Chat only loads or unloads at startup, so a flip needs a restart. */
  #restartRequired() {
    return Services.prefs.getBoolPref(CHAT_PREF, true) !== this.#initialChatPref;
  }

  #startListening() {
    if (this.#listening) {
      return;
    }
    this.#listening = ExtensionSupport.registerWindowListener(ADDON_ID, {
      chromeURLs: [MAIL_WINDOW],
      onLoadWindow: window => {
        if (this.#config) {
          applyToWindow(window, this.#config, this.#initialChatPref);
        }
        addTabGuard(window, () => this.#config);
      },
      onUnloadWindow: removeTabGuard,
    });
  }

  /**
   * Must exist. The manifest declares events: ["startup"], and Thunderbird then
   * calls api.onStartup() with no check that it is there
   * (ExtensionCommon.sys.mjs, SchemaAPIManager.onStartup). Without this method
   * the call throws inside the startup promise chain and the extension ends up
   * enabled but inert: listed and running in the Add-ons Manager, with no
   * options panel and nothing applied. There is genuinely nothing to do here -
   * the background page calls apply() the moment it runs.
   */
  onStartup() {}

  onShutdown(isAppShutdown) {
    if (this.#listening) {
      ExtensionSupport.unregisterWindowListener(ADDON_ID);
      this.#listening = false;
    }
    if (isAppShutdown) {
      return;
    }
    // Disabled, uninstalled or updating: undo everything, including the prefs
    // we set, so removing the add-on leaves no trace.
    styleSheets.remove();
    Services.prefs.clearUserPref(CHAT_PREF);
    Services.prefs.clearUserPref(IMIP_PREF);
    forEachMailWindow(window => {
      removeTabGuard(window);
      restoreWindow(window, this.#initialChatPref);
    });
  }
};
