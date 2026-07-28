const SPACES = ["addressbook", "calendar", "tasks", "chat"];
const DEFAULTS = Object.fromEntries(SPACES.map(space => [space, true]));

const restartBanner = document.getElementById("restart");

function showRestart(required) {
  restartBanner.hidden = !required;
}

async function load() {
  const { spaces } = await browser.storage.local.get({ spaces: DEFAULTS });
  const config = { ...DEFAULTS, ...spaces };
  for (const space of SPACES) {
    document.getElementById(space).checked = config[space];
  }

  const status = await browser.spaceControl.getStatus();
  showRestart(status.restartRequired);
}

async function save() {
  const config = Object.fromEntries(
    SPACES.map(space => [space, document.getElementById(space).checked])
  );
  // The background page also watches storage, but applying here means the
  // window updates before this promise resolves and we get the restart state
  // straight from the same call.
  await browser.storage.local.set({ spaces: config });
  const { restartRequired } = await browser.spaceControl.apply(config);
  showRestart(restartRequired);
}

for (const space of SPACES) {
  document.getElementById(space).addEventListener("change", save);
}

document.getElementById("restart-button").addEventListener("click", () => {
  browser.spaceControl.restart();
});

load();
