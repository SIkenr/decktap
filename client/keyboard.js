const COMMAND_KEYS = Object.freeze({
  next: 'down',
  prev: 'up',
  'next-horizontal': 'right',
  'prev-horizontal': 'left',
});

class KeyboardControlError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'KeyboardControlError';
    this.code = code;
  }
}

function createRobotJsKeyboardAdapter(robotJs) {
  if (!robotJs || typeof robotJs.keyToggle !== 'function') {
    throw new TypeError('A RobotJS module with keyToggle is required');
  }

  return {
    pressKey(key) {
      robotJs.keyToggle(key, 'down');
    },
    releaseKey(key) {
      robotJs.keyToggle(key, 'up');
    },
  };
}

function createKeyboardController(dependencies = {}) {
  let keyboard = dependencies.keyboard;
  const targetWindowController = dependencies.targetWindowController;
  const requireRobotJs = dependencies.requireRobotJs || (() => require('@jitsi/robotjs'));

  function loadKeyboard() {
    if (keyboard) return;

    try {
      keyboard = createRobotJsKeyboardAdapter(requireRobotJs());
    } catch (error) {
      const dependencyError = new KeyboardControlError(
        'KEYBOARD_UNAVAILABLE',
        'Keyboard control is unavailable because @jitsi/robotjs could not be loaded for this platform.',
        { cause: error },
      );
      throw dependencyError;
    }
  }

  return {
    async execute(command) {
      const keyName = COMMAND_KEYS[command];
      if (!keyName) {
        throw new Error(`Unsupported presentation command: ${command}`);
      }

      if (targetWindowController) {
        await targetWindowController.ensureFocused();
      }

      loadKeyboard();
      let pressed = false;

      try {
        await keyboard.pressKey(keyName);
        pressed = true;
      } finally {
        if (pressed) {
          await keyboard.releaseKey(keyName);
        }
      }
    },
  };
}

module.exports = {
  COMMAND_KEYS,
  KeyboardControlError,
  createKeyboardController,
  createRobotJsKeyboardAdapter,
};
