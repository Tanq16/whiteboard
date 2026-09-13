import { getStroke } from '/static/js/perfect-freehand.esm.js';

const canvas = document.getElementById('whiteboard-canvas');
const ctx = canvas.getContext('2d');
const textContainer = document.getElementById('text-input-container');
const textInput = document.getElementById('canvas-text-input');
const zoomIndicator = document.getElementById('zoom-indicator');
const penModeBtn = document.getElementById('btn-pen-mode');
const penModeDot = document.getElementById('pen-mode-dot');

let pan = { x: 0, y: 0 };
let zoom = 1.0;
let dpr = window.devicePixelRatio || 1;

let activeTool = 'pen';
let penMode = false;
let activeColor = '#cdd6f4';
let activeWidth = 4;

let elements = [];
let undoStack = [];
let redoStack = [];

let currentElement = null;
let isPanning = false;
let startPan = { x: 0, y: 0 };
let origPan = { x: 0, y: 0 };

let activePointers = new Map();
let prevTouchCenter = null;
let prevTouchDist = null;

let laserPoints = [];
let isDrawingLaser = false;
let laserAnimFrame = null;

let pendingTextPos = null;

function screenToWorld(sx, sy) {
    return {
        x: (sx - pan.x) / zoom,
        y: (sy - pan.y) / zoom
    };
}

function worldToScreen(wx, wy) {
    return {
        x: wx * zoom + pan.x,
        y: wy * zoom + pan.y
    };
}

function resizeCanvas() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    render();
}

window.addEventListener('resize', resizeCanvas);

function setPenMode(active) {
    penMode = active;
    if (penMode) {
        penModeDot.className = 'w-2 h-2 rounded-full bg-green shadow-sm';
        penModeBtn.classList.add('text-green');
    } else {
        penModeDot.className = 'w-2 h-2 rounded-full bg-surface2';
        penModeBtn.classList.remove('text-green');
    }
}

penModeBtn.addEventListener('click', () => {
    setPenMode(!penMode);
});

function setActiveTool(tool) {
    if (pendingTextPos) {
        commitText();
    }
    activeTool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => {
        if (btn.dataset.tool === tool) {
            btn.classList.add('bg-surface1', 'text-mauve', 'shadow-sm');
            btn.classList.remove('text-subtext0');
        } else {
            btn.classList.remove('bg-surface1', 'text-mauve', 'shadow-sm');
            btn.classList.add('text-subtext0');
        }
    });

    if (tool === 'hand') {
        canvas.style.cursor = 'grab';
    } else if (tool === 'text') {
        canvas.style.cursor = 'text';
    } else {
        canvas.style.cursor = 'crosshair';
    }
}

document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        setActiveTool(btn.dataset.tool);
    });
});

function setActiveColor(color) {
    activeColor = color;
    document.querySelectorAll('.color-btn').forEach(btn => {
        if (btn.dataset.color === color) {
            btn.classList.add('ring-2', 'ring-text', 'ring-offset-2', 'ring-offset-mantle', 'scale-110');
        } else {
            btn.classList.remove('ring-2', 'ring-text', 'ring-offset-2', 'ring-offset-mantle', 'scale-110');
        }
    });
}

document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        setActiveColor(btn.dataset.color);
    });
});

function setActiveWidth(width) {
    activeWidth = Number(width);
    document.querySelectorAll('.width-btn').forEach(btn => {
        if (Number(btn.dataset.width) === activeWidth) {
            btn.classList.add('bg-surface1', 'text-text');
            btn.classList.remove('text-subtext0');
        } else {
            btn.classList.remove('bg-surface1', 'text-text');
            btn.classList.add('text-subtext0');
        }
    });
}

document.querySelectorAll('.width-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        setActiveWidth(btn.dataset.width);
    });
});

function updateZoomIndicator() {
    zoomIndicator.textContent = `${Math.round(zoom * 100)}%`;
}

function applyZoom(newZoom, centerX, centerY) {
    const clamped = Math.min(10.0, Math.max(0.1, newZoom));
    const wx = (centerX - pan.x) / zoom;
    const wy = (centerY - pan.y) / zoom;
    zoom = clamped;
    pan.x = centerX - wx * zoom;
    pan.y = centerY - wy * zoom;
    updateZoomIndicator();
    render();
}

document.getElementById('btn-zoom-in').addEventListener('click', () => {
    applyZoom(zoom * 1.25, window.innerWidth / 2, window.innerHeight / 2);
});

document.getElementById('btn-zoom-out').addEventListener('click', () => {
    applyZoom(zoom * 0.8, window.innerWidth / 2, window.innerHeight / 2);
});

document.getElementById('btn-zoom-reset').addEventListener('click', () => {
    zoom = 1.0;
    pan = { x: 0, y: 0 };
    updateZoomIndicator();
    render();
});

function pushHistory() {
    undoStack.push(JSON.parse(JSON.stringify(elements)));
    if (undoStack.length > 50) {
        undoStack.shift();
    }
    redoStack = [];
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(JSON.parse(JSON.stringify(elements)));
    elements = undoStack.pop();
    render();
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(JSON.parse(JSON.stringify(elements)));
    elements = redoStack.pop();
    render();
}

document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);

document.getElementById('btn-clear').addEventListener('click', () => {
    if (elements.length === 0) return;
    pushHistory();
    elements = [];
    render();
});

function renderPenStroke(targetCtx, points, color, width) {
    if (!points || points.length === 0) return;
    const hasStylusPressure = points.some(p => p.pressure !== 0.5 && p.pressure > 0);
    const strokePoints = getStroke(
        points.map(p => [p.x, p.y, p.pressure ?? 0.5]),
        {
            size: width * 2,
            thinning: 0.5,
            smoothing: 0.5,
            streamline: 0.5,
            simulatePressure: !hasStylusPressure,
            last: true
        }
    );
    if (strokePoints.length === 0) return;

    targetCtx.fillStyle = color;
    targetCtx.beginPath();
    targetCtx.moveTo(strokePoints[0][0], strokePoints[0][1]);
    for (let i = 1; i < strokePoints.length; i++) {
        targetCtx.lineTo(strokePoints[i][0], strokePoints[i][1]);
    }
    targetCtx.closePath();
    targetCtx.fill();
}

function renderArrow(targetCtx, el) {
    const dx = el.endX - el.startX;
    const dy = el.endY - el.startY;
    const angle = Math.atan2(dy, dx);
    const headLength = Math.max(12, el.width * 3.5);

    targetCtx.strokeStyle = el.color;
    targetCtx.fillStyle = el.color;
    targetCtx.lineWidth = el.width;
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';

    targetCtx.beginPath();
    targetCtx.moveTo(el.startX, el.startY);
    targetCtx.lineTo(el.endX, el.endY);
    targetCtx.stroke();

    targetCtx.beginPath();
    targetCtx.moveTo(el.endX, el.endY);
    targetCtx.lineTo(
        el.endX - headLength * Math.cos(angle - Math.PI / 6),
        el.endY - headLength * Math.sin(angle - Math.PI / 6)
    );
    targetCtx.lineTo(
        el.endX - headLength * Math.cos(angle + Math.PI / 6),
        el.endY - headLength * Math.sin(angle + Math.PI / 6)
    );
    targetCtx.closePath();
    targetCtx.fill();
}

function renderElement(targetCtx, el) {
    if (el.type === 'pen') {
        renderPenStroke(targetCtx, el.points, el.color, el.width);
    } else if (el.type === 'line') {
        targetCtx.strokeStyle = el.color;
        targetCtx.lineWidth = el.width;
        targetCtx.lineCap = 'round';
        targetCtx.beginPath();
        targetCtx.moveTo(el.startX, el.startY);
        targetCtx.lineTo(el.endX, el.endY);
        targetCtx.stroke();
    } else if (el.type === 'arrow') {
        renderArrow(targetCtx, el);
    } else if (el.type === 'rect') {
        targetCtx.strokeStyle = el.color;
        targetCtx.lineWidth = el.width;
        targetCtx.lineCap = 'round';
        targetCtx.lineJoin = 'round';
        const rx = Math.min(el.startX, el.endX);
        const ry = Math.min(el.startY, el.endY);
        const rw = Math.abs(el.endX - el.startX);
        const rh = Math.abs(el.endY - el.startY);
        targetCtx.strokeRect(rx, ry, rw, rh);
    } else if (el.type === 'circle') {
        targetCtx.strokeStyle = el.color;
        targetCtx.lineWidth = el.width;
        targetCtx.lineCap = 'round';
        const cx = (el.startX + el.endX) / 2;
        const cy = (el.startY + el.endY) / 2;
        const rx = Math.abs(el.endX - el.startX) / 2;
        const ry = Math.abs(el.endY - el.startY) / 2;
        if (rx > 0 && ry > 0) {
            targetCtx.beginPath();
            targetCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            targetCtx.stroke();
        }
    } else if (el.type === 'text') {
        targetCtx.fillStyle = el.color;
        targetCtx.font = `${el.fontSize || 24}px 'Virgil', cursive, sans-serif`;
        targetCtx.textBaseline = 'top';
        const lines = el.text.split('\n');
        const lineHeight = (el.fontSize || 24) * 1.3;
        lines.forEach((line, idx) => {
            targetCtx.fillText(line, el.x, el.y + idx * lineHeight);
        });
    }
}

function renderLaserTrail(targetCtx) {
    if (laserPoints.length < 2) return;
    const now = performance.now();
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';

    for (let i = 1; i < laserPoints.length; i++) {
        const p1 = laserPoints[i - 1];
        const p2 = laserPoints[i];
        const age = now - p2.time;
        if (age >= 800) continue;
        const alpha = Math.max(0, 1 - age / 800);
        targetCtx.strokeStyle = `rgba(243, 139, 168, ${alpha.toFixed(3)})`;
        targetCtx.lineWidth = Math.max(2, 6 * alpha);
        targetCtx.beginPath();
        targetCtx.moveTo(p1.x, p1.y);
        targetCtx.lineTo(p2.x, p2.y);
        targetCtx.stroke();
    }
}

function render() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.save();
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * pan.x, dpr * pan.y);

    for (const el of elements) {
        renderElement(ctx, el);
    }

    if (currentElement) {
        renderElement(ctx, currentElement);
    }

    renderLaserTrail(ctx);

    ctx.restore();
}

function tickLaser() {
    const now = performance.now();
    laserPoints = laserPoints.filter(p => now - p.time < 800);
    render();
    if (laserPoints.length > 0 || isDrawingLaser) {
        laserAnimFrame = requestAnimationFrame(tickLaser);
    } else {
        laserAnimFrame = null;
    }
}

function openTextInput(screenX, screenY, worldX, worldY) {
    pendingTextPos = { x: worldX, y: worldY };
    textContainer.style.left = `${screenX}px`;
    textContainer.style.top = `${screenY}px`;
    textInput.style.color = activeColor;
    textInput.value = '';
    textContainer.classList.remove('hidden');
    setTimeout(() => {
        textInput.focus();
    }, 10);
}

function commitText() {
    const text = textInput.value.trim();
    if (text.length > 0 && pendingTextPos) {
        pushHistory();
        elements.push({
            type: 'text',
            text: textInput.value,
            x: pendingTextPos.x,
            y: pendingTextPos.y,
            color: activeColor,
            fontSize: 24
        });
    }
    textInput.value = '';
    pendingTextPos = null;
    textContainer.classList.add('hidden');
    render();
}

function cancelText() {
    textInput.value = '';
    pendingTextPos = null;
    textContainer.classList.add('hidden');
    render();
}

textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitText();
    } else if (e.key === 'Escape') {
        cancelText();
    }
});

textInput.addEventListener('blur', () => {
    if (pendingTextPos) {
        commitText();
    }
});

canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen' && !penMode) {
        setPenMode(true);
    }

    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

    if (activePointers.size === 2) {
        if (currentElement) {
            currentElement = null;
            render();
        }
        const pts = Array.from(activePointers.values());
        prevTouchCenter = {
            x: (pts[0].x + pts[1].x) / 2,
            y: (pts[0].y + pts[1].y) / 2
        };
        prevTouchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        return;
    }

    if (activePointers.size > 2) return;

    if (penMode && activeTool !== 'hand' && e.pointerType === 'touch') {
        return;
    }

    if (activeTool === 'hand' || e.button === 1 || e.buttons === 4) {
        isPanning = true;
        startPan = { x: e.clientX, y: e.clientY };
        origPan = { ...pan };
        canvas.style.cursor = 'grabbing';
        canvas.setPointerCapture(e.pointerId);
        return;
    }

    const world = screenToWorld(e.clientX, e.clientY);

    if (activeTool === 'text') {
        openTextInput(e.clientX, e.clientY, world.x, world.y);
        return;
    }

    if (activeTool === 'laser') {
        isDrawingLaser = true;
        laserPoints.push({ x: world.x, y: world.y, time: performance.now() });
        if (!laserAnimFrame) {
            laserAnimFrame = requestAnimationFrame(tickLaser);
        }
        canvas.setPointerCapture(e.pointerId);
        return;
    }

    canvas.setPointerCapture(e.pointerId);
    const pressure = (e.pressure && e.pressure > 0) ? e.pressure : 0.5;

    if (activeTool === 'pen') {
        currentElement = {
            type: 'pen',
            color: activeColor,
            width: activeWidth,
            points: [{ x: world.x, y: world.y, pressure }]
        };
    } else {
        currentElement = {
            type: activeTool,
            color: activeColor,
            width: activeWidth,
            startX: world.x,
            startY: world.y,
            endX: world.x,
            endY: world.y
        };
    }
    render();
});

canvas.addEventListener('pointermove', (e) => {
    if (activePointers.has(e.pointerId)) {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    }

    if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        const center = {
            x: (pts[0].x + pts[1].x) / 2,
            y: (pts[0].y + pts[1].y) / 2
        };
        const dx = center.x - prevTouchCenter.x;
        const dy = center.y - prevTouchCenter.y;
        pan.x += dx;
        pan.y += dy;

        if (activeTool === 'hand') {
            const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            if (prevTouchDist > 0 && dist > 0) {
                const scale = dist / prevTouchDist;
                applyZoom(zoom * scale, center.x, center.y);
            }
            prevTouchDist = dist;
        }

        prevTouchCenter = center;
        render();
        return;
    }

    if (isPanning) {
        pan.x = origPan.x + (e.clientX - startPan.x);
        pan.y = origPan.y + (e.clientY - startPan.y);
        render();
        return;
    }

    if (isDrawingLaser) {
        const world = screenToWorld(e.clientX, e.clientY);
        laserPoints.push({ x: world.x, y: world.y, time: performance.now() });
        return;
    }

    if (!currentElement) return;

    if (currentElement.type === 'pen') {
        const events = (typeof e.getCoalescedEvents === 'function') ? e.getCoalescedEvents() : [e];
        for (const ev of events) {
            const w = screenToWorld(ev.clientX, ev.clientY);
            const p = (ev.pressure && ev.pressure > 0) ? ev.pressure : 0.5;
            currentElement.points.push({ x: w.x, y: w.y, pressure: p });
        }
    } else {
        const w = screenToWorld(e.clientX, e.clientY);
        currentElement.endX = w.x;
        currentElement.endY = w.y;
    }
    render();
});

function endPointer(e) {
    if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
    }
    activePointers.delete(e.pointerId);

    if (isPanning) {
        isPanning = false;
        canvas.style.cursor = activeTool === 'hand' ? 'grab' : 'crosshair';
    }

    if (isDrawingLaser) {
        isDrawingLaser = false;
    }

    if (currentElement) {
        pushHistory();
        elements.push(currentElement);
        currentElement = null;
        render();
    }
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.01);
        applyZoom(zoom * factor, e.clientX, e.clientY);
    } else {
        pan.x -= e.deltaX;
        pan.y -= e.deltaY;
        render();
    }
}, { passive: false });

window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const isCtrlOrCmd = e.ctrlKey || e.metaKey;

    if (isCtrlOrCmd && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
    }
    if ((isCtrlOrCmd && e.key.toLowerCase() === 'y') || (isCtrlOrCmd && e.key.toLowerCase() === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
        return;
    }

    if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        applyZoom(zoom * 1.25, window.innerWidth / 2, window.innerHeight / 2);
        return;
    }
    if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        applyZoom(zoom * 0.8, window.innerWidth / 2, window.innerHeight / 2);
        return;
    }
    if (e.key === '0') {
        e.preventDefault();
        zoom = 1.0;
        pan = { x: 0, y: 0 };
        updateZoomIndicator();
        render();
        return;
    }

    const key = e.key.toLowerCase();
    const toolMap = {
        'h': 'hand',
        'p': 'pen',
        'l': 'line',
        'a': 'arrow',
        'r': 'rect',
        'c': 'circle',
        't': 'text',
        'k': 'laser'
    };
    if (toolMap[key]) {
        setActiveTool(toolMap[key]);
    }
});

function calculateBounds() {
    if (elements.length === 0) {
        return { minX: 0, minY: 0, maxX: 800, maxY: 600, width: 800, height: 600 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const el of elements) {
        if (el.type === 'pen') {
            for (const pt of el.points) {
                minX = Math.min(minX, pt.x - el.width);
                minY = Math.min(minY, pt.y - el.width);
                maxX = Math.max(maxX, pt.x + el.width);
                maxY = Math.max(maxY, pt.y + el.width);
            }
        } else if (el.type === 'line' || el.type === 'arrow') {
            minX = Math.min(minX, el.startX - el.width * 2, el.endX - el.width * 2);
            minY = Math.min(minY, el.startY - el.width * 2, el.endY - el.width * 2);
            maxX = Math.max(maxX, el.startX + el.width * 2, el.endX + el.width * 2);
            maxY = Math.max(maxY, el.startY + el.width * 2, el.endY + el.width * 2);
        } else if (el.type === 'rect') {
            minX = Math.min(minX, el.startX - el.width, el.endX - el.width);
            minY = Math.min(minY, el.startY - el.width, el.endY - el.width);
            maxX = Math.max(maxX, el.startX + el.width, el.endX + el.width);
            maxY = Math.max(maxY, el.startY + el.width, el.endY + el.width);
        } else if (el.type === 'circle') {
            const cx = (el.startX + el.endX) / 2;
            const cy = (el.startY + el.endY) / 2;
            const rx = Math.abs(el.endX - el.startX) / 2 + el.width;
            const ry = Math.abs(el.endY - el.startY) / 2 + el.width;
            minX = Math.min(minX, cx - rx);
            minY = Math.min(minY, cy - ry);
            maxX = Math.max(maxX, cx + rx);
            maxY = Math.max(maxY, cy + ry);
        } else if (el.type === 'text') {
            const lines = el.text.split('\n');
            const maxLen = Math.max(...lines.map(l => l.length));
            const fs = el.fontSize || 24;
            minX = Math.min(minX, el.x);
            minY = Math.min(minY, el.y);
            maxX = Math.max(maxX, el.x + maxLen * fs * 0.7);
            maxY = Math.max(maxY, el.y + lines.length * fs * 1.3);
        }
    }

    const pad = 40;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;

    return {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(100, Math.round(maxX - minX)),
        height: Math.max(100, Math.round(maxY - minY))
    };
}

document.getElementById('btn-export-png').addEventListener('click', () => {
    const bounds = calculateBounds();
    const offCanvas = document.createElement('canvas');
    offCanvas.width = bounds.width * dpr;
    offCanvas.height = bounds.height * dpr;
    const offCtx = offCanvas.getContext('2d');

    offCtx.scale(dpr, dpr);
    offCtx.fillStyle = '#11111b';
    offCtx.fillRect(0, 0, bounds.width, bounds.height);

    offCtx.save();
    offCtx.translate(-bounds.minX, -bounds.minY);
    for (const el of elements) {
        renderElement(offCtx, el);
    }
    offCtx.restore();

    const dataUrl = offCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'whiteboard.png';
    a.click();
});

function escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
}

document.getElementById('btn-export-svg').addEventListener('click', () => {
    const bounds = calculateBounds();
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bounds.width} ${bounds.height}" width="${bounds.width}" height="${bounds.height}">\n`;
    svg += `<style>@import url('/static/css/virgil.css'); text { font-family: 'Virgil', cursive, sans-serif; }</style>\n`;
    svg += `<rect width="100%" height="100%" fill="#11111b" />\n`;
    svg += `<g transform="translate(${-bounds.minX}, ${-bounds.minY})">\n`;

    for (const el of elements) {
        if (el.type === 'pen') {
            const hasStylusPressure = el.points.some(p => p.pressure !== 0.5 && p.pressure > 0);
            const strokePoints = getStroke(
                el.points.map(p => [p.x, p.y, p.pressure ?? 0.5]),
                {
                    size: el.width * 2,
                    thinning: 0.5,
                    smoothing: 0.5,
                    streamline: 0.5,
                    simulatePressure: !hasStylusPressure,
                    last: true
                }
            );
            if (strokePoints.length > 0) {
                const ptsStr = strokePoints.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
                svg += `  <polygon points="${ptsStr}" fill="${el.color}" />\n`;
            }
        } else if (el.type === 'line') {
            svg += `  <line x1="${el.startX}" y1="${el.startY}" x2="${el.endX}" y2="${el.endY}" stroke="${el.color}" stroke-width="${el.width}" stroke-linecap="round" />\n`;
        } else if (el.type === 'arrow') {
            const dx = el.endX - el.startX;
            const dy = el.endY - el.startY;
            const angle = Math.atan2(dy, dx);
            const headLength = Math.max(12, el.width * 3.5);
            const p1x = el.endX - headLength * Math.cos(angle - Math.PI / 6);
            const p1y = el.endY - headLength * Math.sin(angle - Math.PI / 6);
            const p2x = el.endX - headLength * Math.cos(angle + Math.PI / 6);
            const p2y = el.endY - headLength * Math.sin(angle + Math.PI / 6);

            svg += `  <line x1="${el.startX}" y1="${el.startY}" x2="${el.endX}" y2="${el.endY}" stroke="${el.color}" stroke-width="${el.width}" stroke-linecap="round" />\n`;
            svg += `  <polygon points="${el.endX},${el.endY} ${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)}" fill="${el.color}" />\n`;
        } else if (el.type === 'rect') {
            const rx = Math.min(el.startX, el.endX);
            const ry = Math.min(el.startY, el.endY);
            const rw = Math.abs(el.endX - el.startX);
            const rh = Math.abs(el.endY - el.startY);
            svg += `  <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="none" stroke="${el.color}" stroke-width="${el.width}" stroke-linecap="round" stroke-linejoin="round" />\n`;
        } else if (el.type === 'circle') {
            const cx = (el.startX + el.endX) / 2;
            const cy = (el.startY + el.endY) / 2;
            const rx = Math.abs(el.endX - el.startX) / 2;
            const ry = Math.abs(el.endY - el.startY) / 2;
            if (rx > 0 && ry > 0) {
                svg += `  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${el.color}" stroke-width="${el.width}" />\n`;
            }
        } else if (el.type === 'text') {
            const fs = el.fontSize || 24;
            const lines = el.text.split('\n');
            const lh = fs * 1.3;
            lines.forEach((line, idx) => {
                svg += `  <text x="${el.x}" y="${el.y + (idx + 1) * lh - 4}" fill="${el.color}" font-size="${fs}" font-family="Virgil, cursive, sans-serif">${escapeXml(line)}</text>\n`;
            });
        }
    }

    svg += `</g>\n</svg>`;

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'whiteboard.svg';
    a.click();
    URL.revokeObjectURL(url);
});

setActiveTool('pen');
setActiveColor('#cdd6f4');
setActiveWidth(4);
resizeCanvas();
