import { getStroke } from '/static/js/perfect-freehand.esm.js';

const canvas = document.getElementById('whiteboard-canvas');
const ctx = canvas.getContext('2d');
const textContainer = document.getElementById('text-input-container');
const textInput = document.getElementById('canvas-text-input');
const zoomIndicator = document.getElementById('zoom-indicator');
const penModeBtn = document.getElementById('btn-pen-mode');
const penModeDot = document.getElementById('pen-mode-dot');

const toolbar = document.getElementById('toolbar');
const shapesBtn = document.getElementById('btn-add-shapes');
const shapesDropdown = document.getElementById('shapes-dropdown');
const colorPickerBtn = document.getElementById('btn-color-picker');
const activeColorSwatch = document.getElementById('active-color-swatch');
const colorModal = document.getElementById('color-modal');
const widthPickerBtn = document.getElementById('btn-width-picker');
const activeWidthBar = document.getElementById('active-width-bar');
const widthMenu = document.getElementById('width-menu');
const exportMenuBtn = document.getElementById('btn-export-menu');
const exportMenu = document.getElementById('export-menu');
const syncIndicator = document.getElementById('sync-indicator');
const syncDot = document.getElementById('sync-dot');

let pan = { x: 0, y: 0 };
let zoom = 1.0;
let dpr = window.devicePixelRatio || 1;

let activeTool = 'pen';
let penMode = false;
let activeColor = '#cdd6f4';
let activeWidth = 4;

const elements = [];
const elementsById = new Map();
let undoStack = [];
let redoStack = [];

const clientId = crypto.randomUUID();
let zCounter = Date.now();
let lastSeq = 0;
let pendingOps = [];
let flushing = false;
let streamOpen = false;
let queueStalled = false;

let selectedElements = new Set();
let isDraggingSelection = false;
let selectionStartWorld = { x: 0, y: 0 };
let selectionSnapshots = new Map();
let isBoxSelecting = false;
let boxSelectStartWorld = { x: 0, y: 0 };
let boxSelectCurrentWorld = { x: 0, y: 0 };

let currentElement = null;
let isPanning = false;
let startPan = { x: 0, y: 0 };
let origPan = { x: 0, y: 0 };

let activePointers = new Map();
let prevTouchCenter = null;
let prevTouchDist = null;

let isErasing = false;
let eraseLastWorld = null;
const erasingElements = new Set();

let laserTrails = [];
let currentLaserTrail = null;
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

function closeAllDropdowns() {
    shapesDropdown.classList.add('hidden');
    colorModal.classList.add('hidden');
    widthMenu.classList.add('hidden');
    exportMenu.classList.add('hidden');
}

function openDropdown(menu, triggerBtn) {
    const isHidden = menu.classList.contains('hidden');
    closeAllDropdowns();
    if (isHidden) {
        menu.classList.remove('hidden');
        const rect = triggerBtn.getBoundingClientRect();
        const menuWidth = menu.offsetWidth || 160;
        let left = rect.left + (rect.width - menuWidth) / 2;
        if (left + menuWidth > window.innerWidth - 8) {
            left = window.innerWidth - menuWidth - 8;
        }
        if (left < 8) {
            left = 8;
        }
        menu.style.top = `${rect.bottom + 8}px`;
        menu.style.left = `${left}px`;
    }
}

if (toolbar) {
    toolbar.addEventListener('scroll', closeAllDropdowns);
}
window.addEventListener('resize', closeAllDropdowns);

document.addEventListener('click', (e) => {
    if (!e.target.closest('#shapes-dropdown') &&
        !e.target.closest('#color-modal') &&
        !e.target.closest('#width-menu') &&
        !e.target.closest('#export-menu') &&
        !e.target.closest('#btn-add-shapes') &&
        !e.target.closest('#btn-color-picker') &&
        !e.target.closest('#btn-width-picker') &&
        !e.target.closest('#btn-export-menu')) {
        closeAllDropdowns();
    }
});

shapesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDropdown(shapesDropdown, shapesBtn);
});

colorPickerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDropdown(colorModal, colorPickerBtn);
});

widthPickerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDropdown(widthMenu, widthPickerBtn);
});

exportMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDropdown(exportMenu, exportMenuBtn);
});

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
    isErasing = false;
    erasingElements.clear();
    if (tool !== 'select') {
        selectedElements.clear();
        isBoxSelecting = false;
        isDraggingSelection = false;
    }

    const shapeTools = ['rect', 'circle', 'line', 'arrow', 'text'];
    if (shapeTools.includes(tool)) {
        shapesBtn.classList.add('bg-surface1', 'text-mauve', 'shadow-sm');
        shapesBtn.classList.remove('text-subtext0');
    } else {
        shapesBtn.classList.remove('bg-surface1', 'text-mauve', 'shadow-sm');
        shapesBtn.classList.add('text-subtext0');
    }

    document.querySelectorAll('.tool-btn').forEach(btn => {
        if (btn.id === 'btn-add-shapes') return;
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
    } else if (tool === 'select') {
        canvas.style.cursor = 'default';
    } else if (tool === 'text') {
        canvas.style.cursor = 'text';
    } else {
        canvas.style.cursor = 'crosshair';
    }

    render();
}

document.querySelectorAll('.tool-btn').forEach(btn => {
    if (btn.id === 'btn-add-shapes') return;
    btn.addEventListener('click', () => {
        if (btn.dataset.tool) {
            setActiveTool(btn.dataset.tool);
            closeAllDropdowns();
        }
    });
});

function setActiveColor(color) {
    activeColor = color;
    activeColorSwatch.style.backgroundColor = color;
    if (selectedElements.size > 0) {
        const before = Array.from(selectedElements, clone);
        for (const el of selectedElements) {
            el.color = color;
        }
        commit(putOp(Array.from(selectedElements)), putOp(before));
    }
}

document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        setActiveColor(btn.dataset.color);
        closeAllDropdowns();
    });
});

function getFontSizeForWidth(w) {
    const sizeMap = {
        0.5: 14,
        1: 18,
        2: 22,
        4: 28,
        6: 36,
        8: 48,
        12: 64,
        16: 80,
        24: 104
    };
    return sizeMap[w] || Math.round(Math.max(12, w * 5));
}

function setActiveWidth(width) {
    activeWidth = Number(width);
    if (activeWidthBar) {
        if (activeWidth === 0.5) {
            activeWidthBar.style.height = '1px';
            activeWidthBar.style.opacity = '0.7';
        } else {
            activeWidthBar.style.height = `${Math.min(8, Math.max(1, activeWidth))}px`;
            activeWidthBar.style.opacity = '1';
        }
    }
    document.querySelectorAll('.width-btn').forEach(btn => {
        if (Number(btn.dataset.width) === activeWidth) {
            btn.classList.add('bg-surface0');
        } else {
            btn.classList.remove('bg-surface0');
        }
    });
    if (selectedElements.size > 0) {
        const before = Array.from(selectedElements, clone);
        for (const el of selectedElements) {
            el.width = activeWidth;
            if (el.type === 'text') {
                el.fontSize = getFontSizeForWidth(activeWidth);
            }
        }
        commit(putOp(Array.from(selectedElements)), putOp(before));
    }
}

document.querySelectorAll('.width-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        setActiveWidth(btn.dataset.width);
        closeAllDropdowns();
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

function newElementId() {
    return crypto.randomUUID();
}

function nextZ() {
    zCounter += 1;
    return zCounter;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function compareElements(a, b) {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
}

function putOp(els) {
    return { origin: clientId, kind: 'put', elements: els };
}

function deleteOp(ids) {
    return { origin: clientId, kind: 'delete', ids };
}

function clearOp() {
    return { origin: clientId, kind: 'clear' };
}

function applyOp(op) {
    if (op.kind === 'put') {
        let added = false;
        for (const incoming of op.elements) {
            const existing = elementsById.get(incoming.id);
            if (existing) {
                Object.assign(existing, incoming);
            } else {
                const el = clone(incoming);
                elementsById.set(el.id, el);
                elements.push(el);
                added = true;
            }
        }
        if (added) elements.sort(compareElements);
    } else if (op.kind === 'delete') {
        for (const id of op.ids) {
            const el = elementsById.get(id);
            if (!el) continue;
            elementsById.delete(id);
            elements.splice(elements.indexOf(el), 1);
            selectedElements.delete(el);
        }
    } else if (op.kind === 'clear') {
        elements.length = 0;
        elementsById.clear();
        selectedElements.clear();
    }
}

function emit(op) {
    applyOp(op);
    pendingOps.push(JSON.stringify(op));
    flush();
    render();
}

function commit(op, inverse) {
    undoStack.push({ op: clone(op), inverse: clone(inverse) });
    if (undoStack.length > 100) {
        undoStack.shift();
    }
    redoStack.length = 0;
    emit(op);
}

function undo() {
    const entry = undoStack.pop();
    if (!entry) return;
    redoStack.push(entry);
    selectedElements.clear();
    emit(entry.inverse);
}

function redo() {
    const entry = redoStack.pop();
    if (!entry) return;
    undoStack.push(entry);
    selectedElements.clear();
    emit(entry.op);
}

async function flush() {
    if (flushing) return;
    flushing = true;
    while (pendingOps.length > 0) {
        try {
            const res = await fetch('/api/ops', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: pendingOps[0]
            });
            if (res.status >= 400 && res.status < 500) {
                console.error('whiteboard: server rejected op', res.status, await res.text());
                pendingOps.shift();
                continue;
            }
            if (!res.ok) throw new Error(`server returned ${res.status}`);
            pendingOps.shift();
        } catch {
            flushing = false;
            queueStalled = true;
            updateSyncIndicator();
            setTimeout(flush, 1000);
            return;
        }
    }
    flushing = false;
    queueStalled = false;
    updateSyncIndicator();
}

function updateSyncIndicator() {
    const synced = streamOpen && !queueStalled;
    syncDot.classList.toggle('bg-green', synced);
    syncDot.classList.toggle('bg-red', !synced);
    syncIndicator.title = synced ? 'Synced with the server' : 'Disconnected, changes are queued locally';
}

function connect() {
    const stream = new EventSource('/api/events');

    stream.addEventListener('open', () => {
        streamOpen = true;
        updateSyncIndicator();
    });

    stream.addEventListener('error', () => {
        streamOpen = false;
        updateSyncIndicator();
    });

    stream.addEventListener('sync', (e) => {
        const snapshot = JSON.parse(e.data);
        lastSeq = snapshot.seq;
        elements.length = 0;
        elementsById.clear();
        selectedElements.clear();
        for (const el of snapshot.elements) {
            elementsById.set(el.id, el);
            elements.push(el);
        }
        elements.sort(compareElements);
        for (const body of pendingOps) {
            applyOp(JSON.parse(body));
        }
        streamOpen = true;
        updateSyncIndicator();
        render();
    });

    stream.addEventListener('op', (e) => {
        const op = JSON.parse(e.data);
        if (op.seq <= lastSeq) return;
        lastSeq = op.seq;
        streamOpen = true;
        updateSyncIndicator();
        if (op.origin === clientId) return;
        applyOp(op);
        render();
    });
}

document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);

document.getElementById('btn-clear').addEventListener('click', () => {
    if (elements.length === 0) return;
    commit(clearOp(), putOp(elements));
});

function smoothPoints(points) {
    if (!points || points.length <= 2) return points;
    const result = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];

        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const steps = Math.max(1, Math.min(6, Math.floor(dist / 3)));

        for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const t2 = t * t;
            const t3 = t2 * t;

            const x = 0.5 * (
                (2 * p1.x) +
                (-p0.x + p2.x) * t +
                (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
                (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
            );
            const y = 0.5 * (
                (2 * p1.y) +
                (-p0.y + p2.y) * t +
                (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
            );
            const pressure = p1.pressure + (p2.pressure - p1.pressure) * t;
            result.push({ x, y, pressure });
        }
    }
    return result;
}

function computeStrokePoints(rawPoints, width) {
    if (!rawPoints || rawPoints.length === 0) return [];
    const smoothed = smoothPoints(rawPoints);
    const hasStylusPressure = smoothed.some(p => p.pressure !== 0.5 && p.pressure > 0);
    return getStroke(
        smoothed.map(p => [p.x, p.y, p.pressure ?? 0.5]),
        {
            size: width * 2,
            thinning: 0.18,
            smoothing: 0.22,
            streamline: 0.45,
            simulatePressure: !hasStylusPressure,
            last: true
        }
    );
}

function drawStrokeToCanvas(targetCtx, strokePoints) {
    if (strokePoints.length === 0) return;
    targetCtx.beginPath();
    targetCtx.moveTo(strokePoints[0][0], strokePoints[0][1]);
    for (let i = 0; i < strokePoints.length; i++) {
        const [x0, y0] = strokePoints[i];
        const [x1, y1] = strokePoints[(i + 1) % strokePoints.length];
        targetCtx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    targetCtx.closePath();
    targetCtx.fill();
}

function getSvgPathFromStroke(strokePoints) {
    if (!strokePoints || strokePoints.length === 0) return '';
    const d = strokePoints.reduce(
        (acc, [x0, y0], i, arr) => {
            const [x1, y1] = arr[(i + 1) % arr.length];
            acc.push(x0.toFixed(1), y0.toFixed(1), ((x0 + x1) / 2).toFixed(1), ((y0 + y1) / 2).toFixed(1));
            return acc;
        },
        ['M', strokePoints[0][0].toFixed(1), strokePoints[0][1].toFixed(1), 'Q']
    );
    d.push('Z');
    return d.join(' ');
}

function renderPenStroke(targetCtx, points, color, width) {
    const strokePoints = computeStrokePoints(points, width);
    if (strokePoints.length === 0) return;
    targetCtx.fillStyle = color;
    drawStrokeToCanvas(targetCtx, strokePoints);
}

function renderArrow(targetCtx, el) {
    const dx = el.endX - el.startX;
    const dy = el.endY - el.startY;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;

    const angle = Math.atan2(dy, dx);
    const headLength = Math.min(dist * 0.8, Math.max(12, el.width * 3.5));
    const baseDist = headLength * Math.cos(Math.PI / 6);

    const shaftEndX = el.endX - Math.min(dist, baseDist) * Math.cos(angle);
    const shaftEndY = el.endY - Math.min(dist, baseDist) * Math.sin(angle);

    targetCtx.strokeStyle = el.color;
    targetCtx.fillStyle = el.color;
    targetCtx.lineWidth = el.width;
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';

    targetCtx.beginPath();
    targetCtx.moveTo(el.startX, el.startY);
    targetCtx.lineTo(shaftEndX, shaftEndY);
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
        const fs = el.fontSize || getFontSizeForWidth(el.width || 4);
        targetCtx.fillStyle = el.color;
        targetCtx.font = `${fs}px 'Virgil', cursive, sans-serif`;
        targetCtx.textBaseline = 'top';
        const lines = el.text.split('\n');
        const lineHeight = fs * 1.3;
        lines.forEach((line, idx) => {
            targetCtx.fillText(line, el.x, el.y + idx * lineHeight);
        });
    }
}

function distToSegment(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

function getElementBounds(el) {
    if (el.type === 'pen') {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pt of el.points) {
            minX = Math.min(minX, pt.x);
            minY = Math.min(minY, pt.y);
            maxX = Math.max(maxX, pt.x);
            maxY = Math.max(maxY, pt.y);
        }
        if (minX === Infinity) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }
        const pad = Math.max(12, (el.width || 4) * 2);
        return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    } else if (el.type === 'line' || el.type === 'arrow') {
        const pad = Math.max(8, el.width || 4);
        return {
            minX: Math.min(el.startX, el.endX) - pad,
            minY: Math.min(el.startY, el.endY) - pad,
            maxX: Math.max(el.startX, el.endX) + pad,
            maxY: Math.max(el.startY, el.endY) + pad
        };
    } else if (el.type === 'rect') {
        const pad = Math.max(6, el.width || 4);
        return {
            minX: Math.min(el.startX, el.endX) - pad,
            minY: Math.min(el.startY, el.endY) - pad,
            maxX: Math.max(el.startX, el.endX) + pad,
            maxY: Math.max(el.startY, el.endY) + pad
        };
    } else if (el.type === 'circle') {
        const cx = (el.startX + el.endX) / 2;
        const cy = (el.startY + el.endY) / 2;
        const rx = Math.abs(el.endX - el.startX) / 2 + Math.max(6, el.width || 4);
        const ry = Math.abs(el.endY - el.startY) / 2 + Math.max(6, el.width || 4);
        return { minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry };
    } else if (el.type === 'text') {
        const lines = el.text.split('\n');
        const maxLen = Math.max(...lines.map(l => l.length));
        const fs = el.fontSize || getFontSizeForWidth(el.width || 4);
        return {
            minX: el.x - 4,
            minY: el.y - 4,
            maxX: el.x + maxLen * fs * 0.7 + 4,
            maxY: el.y + lines.length * fs * 1.3 + 4
        };
    }
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function hitTestElement(el, wx, wy) {
    const b = getElementBounds(el);
    if (wx < b.minX || wx > b.maxX || wy < b.minY || wy > b.maxY) {
        return false;
    }
    if (el.type === 'pen') {
        const threshold = Math.max(12, (el.width || 4) * 2);
        if (!el.points || el.points.length === 0) return false;
        if (el.points.length === 1) {
            return Math.hypot(wx - el.points[0].x, wy - el.points[0].y) <= threshold;
        }
        for (let i = 0; i < el.points.length; i++) {
            if (Math.hypot(wx - el.points[i].x, wy - el.points[i].y) <= threshold) {
                return true;
            }
        }
        for (let i = 0; i < el.points.length - 1; i++) {
            if (distToSegment(wx, wy, el.points[i].x, el.points[i].y, el.points[i + 1].x, el.points[i + 1].y) <= threshold) {
                return true;
            }
        }
        return false;
    } else if (el.type === 'line' || el.type === 'arrow') {
        return distToSegment(wx, wy, el.startX, el.startY, el.endX, el.endY) <= Math.max(10, (el.width || 4) * 2);
    } else if (el.type === 'rect') {
        const rx = Math.min(el.startX, el.endX);
        const ry = Math.min(el.startY, el.endY);
        const rw = Math.abs(el.endX - el.startX);
        const rh = Math.abs(el.endY - el.startY);
        return wx >= rx - 6 && wx <= rx + rw + 6 && wy >= ry - 6 && wy <= ry + rh + 6;
    } else if (el.type === 'circle') {
        const cx = (el.startX + el.endX) / 2;
        const cy = (el.startY + el.endY) / 2;
        const rx = Math.abs(el.endX - el.startX) / 2;
        const ry = Math.abs(el.endY - el.startY) / 2;
        if (rx === 0 || ry === 0) return false;
        return (((wx - cx) / rx) ** 2 + ((wy - cy) / ry) ** 2) <= 1.25;
    } else if (el.type === 'text') {
        return true;
    }
    return false;
}

function boundsOverlap(b1, b2) {
    return !(b1.maxX < b2.minX || b1.minX > b2.maxX || b1.maxY < b2.minY || b1.minY > b2.maxY);
}

function eraseAlong(from, to) {
    const segment = {
        minX: Math.min(from.x, to.x),
        maxX: Math.max(from.x, to.x),
        minY: Math.min(from.y, to.y),
        maxY: Math.max(from.y, to.y)
    };
    const candidates = elements.filter(el =>
        !erasingElements.has(el) && boundsOverlap(segment, getElementBounds(el))
    );
    if (candidates.length === 0) return false;

    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(dist * zoom / 4));
    let hit = false;
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const wx = from.x + (to.x - from.x) * t;
        const wy = from.y + (to.y - from.y) * t;
        for (const el of candidates) {
            if (!erasingElements.has(el) && hitTestElement(el, wx, wy)) {
                erasingElements.add(el);
                hit = true;
            }
        }
    }
    return hit;
}

function renderSelectionOutline(targetCtx, el) {
    const b = getElementBounds(el);
    targetCtx.save();
    targetCtx.strokeStyle = '#cba6f7';
    targetCtx.lineWidth = 1.5;
    targetCtx.setLineDash([4, 4]);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    targetCtx.strokeRect(b.minX, b.minY, w, h);

    targetCtx.setLineDash([]);
    targetCtx.fillStyle = '#cba6f7';
    const corners = [
        [b.minX, b.minY],
        [b.maxX, b.minY],
        [b.maxX, b.maxY],
        [b.minX, b.maxY]
    ];
    for (const [cx, cy] of corners) {
        targetCtx.beginPath();
        targetCtx.arc(cx, cy, 3.5, 0, Math.PI * 2);
        targetCtx.fill();
    }
    targetCtx.restore();
}

function renderLaserTrail(targetCtx) {
    if (laserTrails.length === 0) return;
    const now = performance.now();
    const duration = 800;

    for (const trail of laserTrails) {
        if (trail.length === 0) continue;

        const laserWidth = trail.width || activeWidth;
        const maxLaserSize = Math.max(1.5, laserWidth * 2);
        const headRadius = Math.max(1.5, maxLaserSize / 2);
        const innerRadius = Math.max(0.8, headRadius * 0.45);

        if (trail.length === 1) {
            const p = trail[0];
            const age = now - p.time;
            if (age < duration) {
                const progress = Math.max(0, 1 - age / duration);
                targetCtx.save();
                targetCtx.fillStyle = '#f38ba8';
                targetCtx.shadowColor = '#f38ba8';
                targetCtx.shadowBlur = Math.max(4, headRadius * 2) * progress;
                targetCtx.beginPath();
                targetCtx.arc(p.x, p.y, Math.max(1, headRadius * progress), 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.restore();
            }
            continue;
        }

        const pts = [];
        for (const p of trail) {
            if (pts.length === 0 || Math.hypot(p.x - pts[pts.length - 1].x, p.y - pts[pts.length - 1].y) >= 1.5) {
                pts.push(p);
            }
        }
        if (pts.length < 2) {
            if (pts.length === 1) {
                const p = pts[0];
                const age = now - p.time;
                if (age < duration) {
                    const progress = Math.max(0, 1 - age / duration);
                    targetCtx.save();
                    targetCtx.fillStyle = '#f38ba8';
                    targetCtx.shadowColor = '#f38ba8';
                    targetCtx.shadowBlur = Math.max(4, headRadius * 2) * progress;
                    targetCtx.beginPath();
                    targetCtx.arc(p.x, p.y, Math.max(1, headRadius * progress), 0, Math.PI * 2);
                    targetCtx.fill();
                    targetCtx.restore();
                }
            }
            continue;
        }

        const strokePoints = getStroke(
            pts.map(p => {
                const age = now - p.time;
                const progress = Math.max(0.01, 1 - age / duration);
                return [p.x, p.y, progress];
            }),
            {
                size: maxLaserSize,
                thinning: 0.85,
                smoothing: 0.35,
                streamline: 0.2,
                simulatePressure: false,
                last: true
            }
        );

        if (strokePoints.length > 0) {
            const tailAge = now - pts[0].time;
            const headAge = now - pts[pts.length - 1].time;
            const avgProgress = Math.max(0.1, 1 - (tailAge + headAge) / (2 * duration));

            targetCtx.save();
            targetCtx.fillStyle = `rgba(243, 139, 168, ${Math.min(1, avgProgress + 0.1).toFixed(3)})`;
            targetCtx.shadowColor = '#f38ba8';
            targetCtx.shadowBlur = Math.max(4, headRadius * 1.5);
            drawStrokeToCanvas(targetCtx, strokePoints);
            targetCtx.restore();
        }

        if (trail === currentLaserTrail && isDrawingLaser && pts.length > 0) {
            const head = pts[pts.length - 1];
            targetCtx.save();
            targetCtx.fillStyle = '#f38ba8';
            targetCtx.shadowColor = '#f38ba8';
            targetCtx.shadowBlur = Math.max(4, headRadius * 2.5);
            targetCtx.beginPath();
            targetCtx.arc(head.x, head.y, headRadius, 0, Math.PI * 2);
            targetCtx.fill();
            targetCtx.fillStyle = '#ffffff';
            targetCtx.beginPath();
            targetCtx.arc(head.x, head.y, innerRadius, 0, Math.PI * 2);
            targetCtx.fill();
            targetCtx.restore();
        }
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
        const fading = erasingElements.has(el);
        if (fading) ctx.globalAlpha = 0.2;
        renderElement(ctx, el);
        if (fading) ctx.globalAlpha = 1;
    }

    if (currentElement) {
        renderElement(ctx, currentElement);
    }

    for (const selEl of selectedElements) {
        renderSelectionOutline(ctx, selEl);
    }

    if (isBoxSelecting) {
        const minX = Math.min(boxSelectStartWorld.x, boxSelectCurrentWorld.x);
        const maxX = Math.max(boxSelectStartWorld.x, boxSelectCurrentWorld.x);
        const minY = Math.min(boxSelectStartWorld.y, boxSelectCurrentWorld.y);
        const maxY = Math.max(boxSelectStartWorld.y, boxSelectCurrentWorld.y);
        ctx.save();
        ctx.fillStyle = 'rgba(203, 166, 247, 0.12)';
        ctx.strokeStyle = '#cba6f7';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
        ctx.restore();
    }

    renderLaserTrail(ctx);

    ctx.restore();
}

function tickLaser() {
    const now = performance.now();
    const duration = 800;

    for (let i = laserTrails.length - 1; i >= 0; i--) {
        const trail = laserTrails[i];
        while (trail.length > 0 && now - trail[0].time >= duration) {
            trail.shift();
        }
        if (trail.length === 0 && trail !== currentLaserTrail) {
            laserTrails.splice(i, 1);
        }
    }

    render();

    if (laserTrails.length > 0 || isDrawingLaser) {
        laserAnimFrame = requestAnimationFrame(tickLaser);
    } else {
        laserAnimFrame = null;
    }
}

function openTextInput(screenX, screenY, worldX, worldY) {
    pendingTextPos = { x: worldX, y: worldY };
    textContainer.style.left = `${screenX}px`;
    textContainer.style.top = `${screenY}px`;
    const fs = getFontSizeForWidth(activeWidth);
    textInput.style.fontSize = `${Math.round(fs * zoom)}px`;
    textInput.style.lineHeight = `${Math.round(fs * zoom * 1.3)}px`;
    textInput.style.color = activeColor;
    textInput.value = '';
    textInput.style.width = '140px';
    textInput.style.height = `${Math.round(fs * zoom * 1.5)}px`;
    textContainer.classList.remove('hidden');
    setTimeout(() => {
        textInput.focus();
    }, 10);
}

function commitText() {
    const text = textInput.value.trim();
    if (text.length > 0 && pendingTextPos) {
        const el = {
            id: newElementId(),
            z: nextZ(),
            type: 'text',
            text: textInput.value,
            x: pendingTextPos.x,
            y: pendingTextPos.y,
            color: activeColor,
            width: activeWidth,
            fontSize: getFontSizeForWidth(activeWidth)
        };
        commit(putOp([el]), deleteOp([el.id]));
    }
    textInput.value = '';
    pendingTextPos = null;
    textContainer.classList.add('hidden');
    render();
}

textInput.addEventListener('input', () => {
    textInput.style.height = 'auto';
    textInput.style.height = `${textInput.scrollHeight}px`;
    textInput.style.width = 'auto';
    textInput.style.width = `${Math.max(140, textInput.scrollWidth + 10)}px`;
});

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

function extractPointerEvents(e) {
    if (typeof e.getCoalescedEvents === 'function') {
        const coalesced = e.getCoalescedEvents();
        if (coalesced && coalesced.length > 0) {
            return coalesced;
        }
    }
    return [e];
}

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
        if (isErasing) {
            isErasing = false;
            erasingElements.clear();
            render();
        }
        isDraggingSelection = false;
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

    if (activeTool === 'select') {
        let hit = null;
        for (let i = elements.length - 1; i >= 0; i--) {
            if (hitTestElement(elements[i], world.x, world.y)) {
                hit = elements[i];
                break;
            }
        }

        const isModifier = e.metaKey || e.ctrlKey;

        if (hit) {
            if (isModifier) {
                if (selectedElements.has(hit)) {
                    selectedElements.delete(hit);
                } else {
                    selectedElements.add(hit);
                }
            } else {
                if (!selectedElements.has(hit)) {
                    selectedElements.clear();
                    selectedElements.add(hit);
                }
            }
            if (selectedElements.has(hit)) {
                isDraggingSelection = true;
                selectionStartWorld = { x: world.x, y: world.y };
                selectionSnapshots.clear();
                for (const selEl of selectedElements) {
                    selectionSnapshots.set(selEl, JSON.parse(JSON.stringify(selEl)));
                }
                canvas.setPointerCapture(e.pointerId);
            }
        } else {
            if (!isModifier) {
                selectedElements.clear();
            }
            isBoxSelecting = true;
            boxSelectStartWorld = { x: world.x, y: world.y };
            boxSelectCurrentWorld = { x: world.x, y: world.y };
            canvas.setPointerCapture(e.pointerId);
        }
        render();
        return;
    }

    if (activeTool === 'text') {
        openTextInput(e.clientX, e.clientY, world.x, world.y);
        return;
    }

    if (activeTool === 'eraser') {
        isErasing = true;
        eraseLastWorld = world;
        canvas.setPointerCapture(e.pointerId);
        eraseAlong(world, world);
        render();
        return;
    }

    if (activeTool === 'laser') {
        isDrawingLaser = true;
        currentLaserTrail = [];
        currentLaserTrail.width = activeWidth;
        laserTrails.push(currentLaserTrail);
        const events = extractPointerEvents(e);
        for (const ev of events) {
            const w = screenToWorld(ev.clientX, ev.clientY);
            currentLaserTrail.push({ x: w.x, y: w.y, time: performance.now() });
        }
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
            id: newElementId(),
            z: nextZ(),
            type: 'pen',
            color: activeColor,
            width: activeWidth,
            points: [{ x: world.x, y: world.y, pressure }]
        };
    } else {
        currentElement = {
            id: newElementId(),
            z: nextZ(),
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

    if (isDraggingSelection && selectionSnapshots.size > 0) {
        const world = screenToWorld(e.clientX, e.clientY);
        const dx = world.x - selectionStartWorld.x;
        const dy = world.y - selectionStartWorld.y;

        for (const [selEl, snap] of selectionSnapshots.entries()) {
            if (selEl.type === 'pen') {
                selEl.points = snap.points.map(p => ({
                    x: p.x + dx,
                    y: p.y + dy,
                    pressure: p.pressure
                }));
            } else if (selEl.type === 'text') {
                selEl.x = snap.x + dx;
                selEl.y = snap.y + dy;
            } else {
                selEl.startX = snap.startX + dx;
                selEl.startY = snap.startY + dy;
                selEl.endX = snap.endX + dx;
                selEl.endY = snap.endY + dy;
            }
        }
        render();
        return;
    }

    if (isBoxSelecting) {
        boxSelectCurrentWorld = screenToWorld(e.clientX, e.clientY);
        const box = {
            minX: Math.min(boxSelectStartWorld.x, boxSelectCurrentWorld.x),
            maxX: Math.max(boxSelectStartWorld.x, boxSelectCurrentWorld.x),
            minY: Math.min(boxSelectStartWorld.y, boxSelectCurrentWorld.y),
            maxY: Math.max(boxSelectStartWorld.y, boxSelectCurrentWorld.y)
        };
        if (!e.metaKey && !e.ctrlKey) {
            selectedElements.clear();
        }
        for (const el of elements) {
            const eb = getElementBounds(el);
            if (boundsOverlap(box, eb)) {
                selectedElements.add(el);
            }
        }
        render();
        return;
    }

    if (activeTool === 'select') {
        const world = screenToWorld(e.clientX, e.clientY);
        let hovering = false;
        for (let i = elements.length - 1; i >= 0; i--) {
            if (hitTestElement(elements[i], world.x, world.y)) {
                hovering = true;
                break;
            }
        }
        canvas.style.cursor = hovering ? 'move' : 'default';
        return;
    }

    if (isErasing) {
        let changed = false;
        for (const ev of extractPointerEvents(e)) {
            const world = screenToWorld(ev.clientX, ev.clientY);
            if (eraseAlong(eraseLastWorld, world)) changed = true;
            eraseLastWorld = world;
        }
        if (changed) render();
        return;
    }

    if (isDrawingLaser && currentLaserTrail) {
        const events = extractPointerEvents(e);
        for (const ev of events) {
            const world = screenToWorld(ev.clientX, ev.clientY);
            currentLaserTrail.push({ x: world.x, y: world.y, time: performance.now() });
        }
        return;
    }

    if (!currentElement) return;

    if (currentElement.type === 'pen') {
        const events = extractPointerEvents(e);
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
        canvas.style.cursor = activeTool === 'hand' ? 'grab' : (activeTool === 'select' ? 'default' : 'crosshair');
    }

    if (isDraggingSelection) {
        const world = screenToWorld(e.clientX, e.clientY);
        const dx = world.x - selectionStartWorld.x;
        const dy = world.y - selectionStartWorld.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            const before = Array.from(selectionSnapshots.values());
            const after = Array.from(selectionSnapshots.keys());
            commit(putOp(after), putOp(before));
        }
        isDraggingSelection = false;
        selectionSnapshots.clear();
    }

    if (isBoxSelecting) {
        isBoxSelecting = false;
        render();
    }

    if (isDrawingLaser) {
        isDrawingLaser = false;
        currentLaserTrail = null;
    }

    if (isErasing) {
        isErasing = false;
        eraseLastWorld = null;
        const removed = Array.from(erasingElements).filter(el => elementsById.has(el.id));
        erasingElements.clear();
        if (removed.length > 0) {
            commit(deleteOp(removed.map(el => el.id)), putOp(removed));
        } else {
            render();
        }
    }

    if (currentElement) {
        const el = currentElement;
        currentElement = null;
        commit(putOp([el]), deleteOp([el.id]));
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

    if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedElements.size > 0) {
            e.preventDefault();
            const removed = Array.from(selectedElements);
            selectedElements.clear();
            commit(deleteOp(removed.map(el => el.id)), putOp(removed));
            return;
        }
    }

    if (e.key === 'Escape') {
        if (selectedElements.size > 0) {
            selectedElements.clear();
            render();
            return;
        }
        closeAllDropdowns();
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
        'v': 'select',
        '1': 'select',
        'h': 'hand',
        'p': 'pen',
        'l': 'line',
        'a': 'arrow',
        'r': 'rect',
        'c': 'circle',
        't': 'text',
        'e': 'eraser',
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
        const b = getElementBounds(el);
        minX = Math.min(minX, b.minX);
        minY = Math.min(minY, b.minY);
        maxX = Math.max(maxX, b.maxX);
        maxY = Math.max(maxY, b.maxY);
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
    closeAllDropdowns();
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
    closeAllDropdowns();
    const bounds = calculateBounds();
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bounds.width} ${bounds.height}" width="${bounds.width}" height="${bounds.height}">\n`;
    svg += `<style>@import url('/static/css/virgil.css'); text { font-family: 'Virgil', cursive, sans-serif; }</style>\n`;
    svg += `<rect width="100%" height="100%" fill="#11111b" />\n`;
    svg += `<g transform="translate(${-bounds.minX}, ${-bounds.minY})">\n`;

    for (const el of elements) {
        if (el.type === 'pen') {
            const strokePoints = computeStrokePoints(el.points, el.width);
            const pathData = getSvgPathFromStroke(strokePoints);
            if (pathData) {
                svg += `  <path d="${pathData}" fill="${el.color}" />\n`;
            }
        } else if (el.type === 'line') {
            svg += `  <line x1="${el.startX}" y1="${el.startY}" x2="${el.endX}" y2="${el.endY}" stroke="${el.color}" stroke-width="${el.width}" stroke-linecap="round" />\n`;
        } else if (el.type === 'arrow') {
            const dx = el.endX - el.startX;
            const dy = el.endY - el.startY;
            const dist = Math.hypot(dx, dy);
            if (dist > 0) {
                const angle = Math.atan2(dy, dx);
                const headLength = Math.min(dist * 0.8, Math.max(12, el.width * 3.5));
                const baseDist = headLength * Math.cos(Math.PI / 6);
                const shaftEndX = (el.endX - Math.min(dist, baseDist) * Math.cos(angle)).toFixed(1);
                const shaftEndY = (el.endY - Math.min(dist, baseDist) * Math.sin(angle)).toFixed(1);
                const p1x = (el.endX - headLength * Math.cos(angle - Math.PI / 6)).toFixed(1);
                const p1y = (el.endY - headLength * Math.sin(angle - Math.PI / 6)).toFixed(1);
                const p2x = (el.endX - headLength * Math.cos(angle + Math.PI / 6)).toFixed(1);
                const p2y = (el.endY - headLength * Math.sin(angle + Math.PI / 6)).toFixed(1);

                svg += `  <line x1="${el.startX}" y1="${el.startY}" x2="${shaftEndX}" y2="${shaftEndY}" stroke="${el.color}" stroke-width="${el.width}" stroke-linecap="round" />\n`;
                svg += `  <polygon points="${el.endX},${el.endY} ${p1x},${p1y} ${p2x},${p2y}" fill="${el.color}" />\n`;
            }
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
            const fs = el.fontSize || getFontSizeForWidth(el.width || 4);
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
updateSyncIndicator();
connect();
