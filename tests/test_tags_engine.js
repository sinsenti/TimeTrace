const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '../src/timetrace/interfaces/api/static/js/tags_engine.js'),
    'utf8'
);

test('resetting session tags clears a previously typed tag', () => {
    const input = { value: '' };
    const container = {
        querySelectorAll: () => [],
        insertBefore: () => {}
    };
    const context = {
        document: {
            createElement: () => ({ style: {} }),
            getElementById(id) {
                if (id === 'session_modal_tags_input') return input;
                if (id === 'tag_chips_container') return container;
                return null;
            }
        },
        getTagColor: () => '#000000'
    };

    vm.runInNewContext(source, context);
    context.setTagChips('#previous');
    input.value = '#previous';

    // Opening a new session resets the chips, but used to leave the previous typed tag behind.
    context.setTagChips('');

    assert.equal(input.value, '');
});
