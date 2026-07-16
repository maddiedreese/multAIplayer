(() => {
  const blocked = () =>
    Promise.reject(
      new DOMException("multAIplayer blocks room browser clipboard access by default.", "NotAllowedError")
    );
  try {
    if (navigator.clipboard) {
      Object.defineProperty(navigator, "clipboard", {
        configurable: false,
        enumerable: true,
        value: Object.freeze({
          read: blocked,
          readText: blocked,
          write: blocked,
          writeText: blocked
        })
      });
    }
  } catch (_) {}

  const isFileInput = (target) => {
    if (!target || !target.closest) return false;
    return Boolean(target.closest("input[type=file]"));
  };
  const block = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener(
    "click",
    (event) => {
      if (isFileInput(event.target)) block(event);
    },
    true
  );
  window.addEventListener(
    "change",
    (event) => {
      if (isFileInput(event.target)) {
        try {
          event.target.value = "";
        } catch (_) {}
        block(event);
      }
    },
    true
  );
  window.addEventListener("drop", block, true);
  window.addEventListener("dragover", block, true);
})();
