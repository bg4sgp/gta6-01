// Keyboard and mouse state for the game. The rest of the game reads this one
// object each frame; the screenshot pilot writes into it too, so a staged scene
// is driven by exactly the same inputs as a player's hands.

export function createInput(canvas) {
  const input = {
    keys: new Set(),
    mouseX: 0,
    mouseY: 0,
    mouseDown: false,
    clicked: false, // set for one frame on mousedown
    pressed: new Set(), // key codes that went down this frame
  };

  const down = (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (!e.repeat) input.pressed.add(e.code);
    input.keys.add(e.code);
  };
  const up = (e) => input.keys.delete(e.code);
  const move = (e) => {
    const rect = canvas.getBoundingClientRect();
    input.mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
    input.mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
  };
  const mDown = (e) => {
    input.mouseDown = true;
    input.clicked = true;
    move(e);
  };
  const mUp = () => { input.mouseDown = false; };

  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', () => input.keys.clear());
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mousedown', mDown);
  window.addEventListener('mouseup', mUp);

  /** Call once per frame after the frame has read its one-shot inputs. */
  input.endFrame = () => {
    input.clicked = false;
    input.pressed.clear();
  };
  input.down = (code) => input.keys.has(code);
  input.hit = (code) => input.pressed.has(code);
  return input;
}
