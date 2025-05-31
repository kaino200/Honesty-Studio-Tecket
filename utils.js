const fs = require('fs');
const path = require('path');

function loadJson(file) {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, file)));
    } catch {
        return {};
    }
}

function saveJson(file, data) {
    fs.writeFileSync(path.join(__dirname, file), JSON.stringify(data, null, 2));
}

function nextTicketNumber() {
    let tickets = loadJson('./data/tickets.json');
    let numbers = Object.values(tickets).map(t => t.number || 0);
    return (Math.max(0, ...numbers) + 1);
}

function getRoleLabel(member, config) {
    if (member.roles.cache.has(config.roles.CEO)) return 'CEO';
    if (member.roles.cache.has(config.roles.Modrator)) return 'Modrator';
    return 'الإداري';
}

function parseDuration(text) {
    if (!text) return null;
    let match = text.match(/^(\d+)([smhdw])$/i);
    if (!match) return null;
    let num = parseInt(match[1]);
    let unit = match[2].toLowerCase();
    switch (unit) {
        case 's': return num * 1000;
        case 'm': return num * 60 * 1000;
        case 'h': return num * 60 * 60 * 1000;
        case 'd': return num * 24 * 60 * 60 * 1000;
        case 'w': return num * 7 * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

module.exports = {
    loadJson, saveJson, nextTicketNumber, getRoleLabel, parseDuration
};