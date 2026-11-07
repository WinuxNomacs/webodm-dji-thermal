// Each page loads every script its scripts read from window (root.ThermalX, set by the script that exports it),
// before them: the Analyzer's templates, and the Thermal Inspector's scripts main.js loads on WebODM's map pages
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..');
const TEMPLATES = path.join(PUBLIC, '..', 'templates');

function source(name) { return fs.readFileSync(path.join(PUBLIC, name), 'utf8'); }
function exported(name) { return (source(name).match(/root\.(Thermal\w+) = /g) || []).map(s => s.slice(5, -3)); }
function needed(name) {
    return (source(name).match(/root\.(Thermal\w+) \|\| \(typeof require/g) || []).map(s => s.split(' ')[0].slice(5));
}
function missing(scripts) {
    const have = new Set(), out = [];
    scripts.forEach(name => {
        needed(name).filter(n => !have.has(n) && !exported(name).includes(n)).forEach(n => out.push(name + " needs " + n));
        exported(name).forEach(n => have.add(n));
    });
    return out;
}

describe('the scripts each page loads', () => {
    const templates = fs.readdirSync(TEMPLATES).filter(n => n.endsWith('.html'));

    test.each(templates)('%s loads what its scripts need, before them', (template) => {
        const html = fs.readFileSync(path.join(TEMPLATES, template), 'utf8');
        const scripts = [...html.matchAll(/<script src="\{\{ public \}\}([\w.]+)\?/g)].map(m => m[1]);
        expect(missing(scripts)).toEqual([]);
    });

    test("WebODM's map pages load the Thermal Inspector's scripts in an order that has what each needs", () => {
        const names = JSON.parse(/var NAMES = (\[[^\]]*\])/.exec(source('main.js'))[1]);
        expect(names[names.length - 1]).toBe('inspector.js');
        expect(missing(names)).toEqual([]);
    });
});
