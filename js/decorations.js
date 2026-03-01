// decorations.js — Squiggle drawing, curlicue placement, text vocoder decoration

export class DecorationTool {
  constructor(state, canvasEl, canvasSize) {
    this.state = state;
    this.canvas = canvasEl;
    this.canvasSize = canvasSize;
    this.isDrawing = false;
    this.currentPoints = [];
    this.currentTool = null;
  }

  setTool(tool) {
    this.currentTool = tool; // 'squiggle', 'curlicue', 'text', or null
  }

  handleMouseDown(nx, ny) {
    if (this.currentTool === 'squiggle') {
      this.isDrawing = true;
      this.currentPoints = [[nx, ny]];
      return { drawing: true };
    }
    if (this.currentTool === 'curlicue') {
      this.state.addDecoration('curlicue', [], 'hsl(280, 100%, 65%)');
      const deco = this.state.data.decorations[this.state.data.decorations.length - 1];
      deco.x = nx;
      deco.y = ny;
      this.state._notify();
      return { placed: deco.id };
    }
    if (this.currentTool === 'text') {
      const text = document.getElementById('text-input').value.trim();
      if (!text) return null;
      const deco = this.state.addDecoration('text', [], 'hsl(50, 100%, 60%)');
      deco.text = text;
      deco.x = nx;
      deco.y = ny;
      this.state._notify();
      return { placed: deco.id };
    }
    return null;
  }

  handleMouseMove(nx, ny) {
    if (!this.isDrawing) return;
    const last = this.currentPoints[this.currentPoints.length - 1];
    const dx = (nx - last[0]) * this.canvasSize;
    const dy = (ny - last[1]) * this.canvasSize;
    // Only add point if moved enough (4px threshold)
    if (dx * dx + dy * dy > 16) {
      this.currentPoints.push([nx, ny]);
    }
  }

  handleMouseUp() {
    if (!this.isDrawing) return null;
    this.isDrawing = false;
    let decoId = null;
    if (this.currentPoints.length >= 2) {
      const deco = this.state.addDecoration(
        'squiggle',
        [...this.currentPoints],
        'hsl(320, 100%, 60%)',
      );
      decoId = deco.id;
    }
    this.currentPoints = [];
    return decoId;
  }

  // Get points currently being drawn (for live preview)
  getDrawingPoints() {
    return this.isDrawing ? this.currentPoints : null;
  }
}
