/* Space Control - keeps the chrome side in sync with the stored settings. */

const DEFAULTS = {
  addressbook: true,
  calendar: true,
  tasks: true,
  chat: true,
};

async function readConfig() {
  const { spaces } = await browser.storage.local.get({ spaces: DEFAULTS });
  return { ...DEFAULTS, ...spaces };
}

async function applyStoredConfig() {
  try {
    await browser.spaceControl.apply(await readConfig());
  } catch (error) {
    // Most likely cause: the experiment API did not load, which means
    // extensions.experiments.enabled is off.
    console.error("Space Control could not apply its settings:", error);
  }
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area == "local" && changes.spaces) {
    applyStoredConfig();
  }
});

applyStoredConfig();
