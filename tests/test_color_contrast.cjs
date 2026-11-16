const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const utilityPath = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js/utils.js');
const context = vm.createContext({
    localStorage: { getItem: () => null },
    document: { getElementById: () => null },
    window: { addEventListener() {} }
});
vm.runInContext(fs.readFileSync(utilityPath, 'utf8'), context, { filename: utilityPath });

function luminance(hexColor) {
    const hex = hexColor.slice(1).replace(/^([0-9a-f])([0-9a-f])([0-9a-f])$/i, '$1$1$2$2$3$3');
    const channels = [0, 2, 4].map(index => {
        const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function foreground(background) {
    return vm.runInContext(`getContrastingTextColor(${JSON.stringify(background)})`, context);
}

test('repairs the measured calendar blue pair while retaining its background', () => {
    const background = '#0284c7';
    const selectedForeground = foreground(background);

    assert.equal(selectedForeground, '#000000');
    assert.ok(contrastRatio(selectedForeground, background) >= 4.5);
    assert.equal(background, '#0284c7');
});

test('keeps already-passing chosen foregrounds byte-for-byte stable', () => {
    assert.equal(foreground('#7c3aed'), '#ffffff');
    assert.equal(foreground('#e2e8f0'), '#111827');
    assert.equal(foreground('#ffffff'), '#111827');
});

test('supports short and full hex and keeps unsupported input fallback', () => {
    assert.equal(foreground('#08c'), foreground('#0088cc'));
    assert.equal(foreground('rgb(2, 132, 199)'), '#ffffff');
    assert.equal(foreground('#abcd'), '#ffffff');
    assert.equal(foreground(null), '#ffffff');
});
