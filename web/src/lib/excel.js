// Excel export of the registered students (admin only). The writer is loaded
// on demand so it never weighs on the other screens.

const YEAR = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year' };
const SOURCE = { self: 'Registration form', admin: 'Added by the admin', import: 'Imported' };

/** "13/11/2026 21:05" in the admin's own time zone (Excel dates carry no time zone). */
const when = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const HEAD = { fontWeight: 'bold', backgroundColor: '#22173A', textColor: '#FFFFFF', align: 'center', alignVertical: 'center', height: 24 };

/** The workbook: every registration, a summary and (once drawn) the teams. */
export function buildSheets(people, teams = []) {
  const teamName = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const sorted = people.slice().sort((a, b) => a.fullName.localeCompare(b.fullName, 'fr', { sensitivity: 'base' }));

  const header = ['#', 'Full name', 'Phone', 'Field', 'Year', 'Confirmed present', 'Checked in at', 'Registered at', 'Source', 'Team']
    .map((value) => ({ value, ...HEAD }));
  const rows = sorted.map((p, i) => [
    { value: i + 1, type: Number },
    { value: p.fullName, type: String },
    { value: p.phone || '', type: String }, // text, so leading zeros stay
    { value: p.filiere || '', type: String },
    { value: YEAR[p.year] || '', type: String },
    { value: p.checkedInAt ? 'Yes' : 'No', type: String, textColor: p.checkedInAt ? '#0B7A50' : '#B42318', fontWeight: 'bold' },
    { value: when(p.checkedInAt), type: String },
    { value: when(p.createdAt), type: String },
    { value: SOURCE[p.source] || '', type: String },
    { value: (p.teamId && teamName[p.teamId]) || '', type: String },
  ]);
  const confirmed = people.filter((p) => p.checkedInAt).length;
  const summary = [
    [{ value: 'Registered', fontWeight: 'bold' }, { value: people.length, type: Number }],
    [{ value: 'Confirmed present', fontWeight: 'bold' }, { value: confirmed, type: Number }],
    [{ value: 'Not confirmed', fontWeight: 'bold' }, { value: people.length - confirmed, type: Number }],
    ...[1, 2, 3].map((y) => [{ value: `${YEAR[y]} (confirmed / registered)`, fontWeight: 'bold' }, { value: `${people.filter((p) => p.year === y && p.checkedInAt).length} / ${people.filter((p) => p.year === y).length}`, type: String }]),
    [{ value: 'Exported at', fontWeight: 'bold' }, { value: when(Date.now()), type: String }],
  ];

  const sheets = [
    {
      sheet: 'Registrations',
      data: [header, ...rows],
      columns: [{ width: 5 }, { width: 30 }, { width: 18 }, { width: 26 }, { width: 11 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 20 }, { width: 24 }],
      stickyRowsCount: 1,
    },
    {
      sheet: 'Summary',
      data: summary,
      columns: [{ width: 34 }, { width: 18 }],
    },
  ];
  if (teams.length) {
    const teamRows = [];
    for (const t of teams) {
      const members = people.filter((p) => p.teamId === t.id);
      members.forEach((p, i) => teamRows.push([
        { value: i === 0 ? t.name : '', type: String, fontWeight: 'bold' },
        { value: p.fullName, type: String },
        { value: p.phone || '', type: String },
        { value: p.filiere || '', type: String },
        { value: YEAR[p.year] || '', type: String },
      ]));
    }
    sheets.push({
      sheet: 'Teams',
      data: [['Team', 'Member', 'Phone', 'Field', 'Year'].map((value) => ({ value, ...HEAD })), ...teamRows],
      columns: [{ width: 24 }, { width: 30 }, { width: 18 }, { width: 26 }, { width: 11 }],
      stickyRowsCount: 1,
    });
  }
  return sheets;
}

/** Downloads N7-registrations-YYYY-MM-DD.xlsx. */
export async function exportParticipants(people, teams = []) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await writeExcelFile(buildSheets(people, teams)).toFile(`N7-registrations-${stamp}.xlsx`);
}
