/*
 * The two things a search card and a person's own record page have to agree
 * about, in one place.
 *
 * 1. Which table a cemetery's data really lives in.
 *
 *    The record page (renderGrave.js), the administrator edit form
 *    (getUpdateRecord.js) and the search result cards (renderSearch.js) all
 *    read the BASE tables (bcmg_data, capernaum_data, honeyford_data) rather
 *    than the <cemetery>_data_formatted_2 views, because the views do not carry
 *    the day of the month of a death date: 2,154 records hold one and the view
 *    shows a day on none of them. Reading the same table the save writes to
 *    (updateRecord.js writes the base table) is what stops a page, a form and a
 *    write disagreeing.
 *
 * 2. How the base table's three date columns become the one string the
 *    templates parse.
 *
 *    public/views/partials/record-display.ejs reads a single "month/day/year"
 *    string with a zero standing for a part that was never recorded
 *    ("01/28/1907", "09/12/2008", "0/0/1967"), and both the search cards
 *    (search.ejs) and the record page (grave.ejs) use those display rules. The
 *    base table stores that date as three columns instead (month as a name,
 *    day and year as numbers), so it has to be put back together once, here,
 *    for both callers. A second copy of this in either function could drift,
 *    and that is exactly the bug being fixed: the card showed "09/2008" where
 *    the page showed "09/12/2008" because the two read different sources.
 *
 * Nothing here queries, writes or renders: no database object is created, no
 * template is read, and no column list lives here. It is only names and string
 * handling, so it can be required by a Netlify function without a side effect.
 * (Netlify treats every .js file in netlify/functions/ as a function entry
 * point; this one exports no handler, exactly like the existing
 * findCemetery.js helper next to it.)
 */

//The suffix every cemetery view carries, so a cemetery slug ("bcmg") and the
//view findCemetery.js resolves a record through ("bcmg_data_formatted_2") name
//the same base table.
const VIEW_SUFFIX = '_data_formatted_2';

//The table a cemetery's data really lives in, from the name of the formatted
//view findCemetery.js resolved the record through.
//
//This is the SAME derivation the save path uses (netlify/functions/updateRecord.js:
//`cemetery.split("_", 2).join("_")`, i.e. "bcmg_data_formatted_2" -> "bcmg_data"),
//applied to the same input, so a read can only ever name the table a save writes
//to. It is deliberately not a hand-written table of names: a second list could
//drift away from the write.
function baseTableFor(cemeteryView) {
  return String(cemeteryView).split('_', 2).join('_');
}

//The same table, named from the cemetery slug a search request carries
//("bcmg" -> "bcmg_data"). The slug goes through the identical derivation as the
//view name, so there is still only one expression deciding which table is read.
function baseTableForCemetery(cemeteryCode) {
  return baseTableFor(String(cemeteryCode) + VIEW_SUFFIX);
}

//The base table keeps a date as three separate columns — the month as a name
//("Jan", "Sep"), the day and the year as numbers — while the page's display
//rules (partials/record-display.ejs) read one string. So the parts are put back
//together in the shape that file documents: month/day/year, with a zero standing
//for a part that was never recorded ("01/28/1907", "09/12/2008", "0/0/1967").
//Those rules drop a zero, so no zero is ever printed, and they suppress a day
//that has no month. The month is written as a two-digit number because that is
//how the formatted views write it (the view renders the same "Sep" as "09").
const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

//A stored part of a date, or "" when nothing was recorded. A stored 0 is a
//placeholder meaning "not recorded" here as much as an empty cell is.
function recordedPart(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (text === '' || /^0+$/.test(text)) return '';
  return text;
}

//The month as a two-digit number: a stored name ("Sep", "September") or a
//stored number. Anything unrecognisable counts as not recorded.
function monthPart(value) {
  const part = recordedPart(value);
  if (part === '') return '';
  if (/^\d+$/.test(part)) return part.length === 1 ? '0' + part : part;
  return MONTHS[part.slice(0, 3).toLowerCase()] || '';
}

//The day, as stored. A day is only used when the record also carries its month,
//so a stray day can never be printed as though it were a month.
function dayPart(value) {
  const part = recordedPart(value);
  return /^\d+$/.test(part) ? part : '';
}

//The year. The display rules take a four-digit part as the year and nothing
//else, so anything that is not four digits is left out rather than misplaced.
function yearPart(value) {
  const part = recordedPart(value);
  return /^\d{4}$/.test(part) ? part : '';
}

//One date column of the base table, as the single string the display rules read.
function composedDate(month, day, year) {
  const monthText = monthPart(month);
  const dayText = monthText === '' ? '' : dayPart(day);
  const yearText = yearPart(year);
  if (monthText === '' && dayText === '' && yearText === '') return '';
  return (monthText || '0') + '/' + (dayText || '0') + '/' + (yearText || '0');
}

//A base-table row as the templates expect it: the table's own columns, plus the
//birth_date / death_date strings the display rules parse, and the age the record
//carries (age_sane if the base table has that column; the year difference the
//view itself worked out otherwise). A column the base table does not have stays
//absent, and the templates then render exactly as they do for a record with
//nothing recorded in it — never "undefined", never an empty row.
//
//The row is copied, never modified in place, so the caller's data (and the
//response the database sent) is left as it was.
function displayRecord(row) {
  const record = Object.assign({}, row, {
    birth_date: composedDate(row.birth_month, row.birth_day, row.birth_year),
    death_date: composedDate(row.death_month, row.death_day, row.death_year)
  });
  if (recordedPart(record.age_sane) === '') {
    const bornYear = Number(yearPart(row.birth_year));
    const diedYear = Number(yearPart(row.death_year));
    const years = (bornYear && diedYear) ? diedYear - bornYear : 0;
    record.age_sane = years > 0 ? String(years) : '';
  }
  return record;
}

module.exports = {
  baseTableFor,
  baseTableForCemetery,
  displayRecord,
  composedDate,
  recordedPart,
  monthPart,
  dayPart,
  yearPart,
  VIEW_SUFFIX,
  MONTHS
};
