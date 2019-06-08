// ==UserScript==
// @name          MyKetoPal
// @namespace     http://yo1.dog
// @version       1.0.0
// @description   Optimizes MyFitnessPal for a Ketogenic diet
// @author        Mike "yo1dog" Moore
// @match         http*://www.myfitnesspal.com/food/diary*
// @match         http*://www.myfitnesspal.com/reports/printable_diary*
// @run-at        document-end
// ==/UserScript==

/* global google */

/**
 * @typedef {'full'|'printable'} DiaryType
 * 
 * @typedef DiaryEntry
 * @property {DiaryType} type
 * @property {Element} elem
 * 
 * @typedef DiaryColumn
 * @property {string} name
 * @property {number} index
 * @property {Element} headerCellElem
 */


(async function run() {
  await loadGoogleAPI();
  
  // get all the diaries on the page
  const diaries = getDiaryEntries(document);
})();

async function loadGoogleAPI() {
  const script = document.createElement('script');
  script.setAttribute('src', '//www.gstatic.com/charts/loader.js');
  document.body.appendChild(script);
  await new Promise(resolve => script.addEventListener('load', resolve, {once: true}));
  
  google.load('current', {packages: ['corechart']});
  await new Promise(resolve => google.charts.setOnLoadCallback(resolve));
}

/**
 * @param {Element} container
 * @returns {DiaryEntry[]} 
 */
function getDiaryEntries(container) {
  // NOTE: we use the [id=] selector instead of # because MyFitnessPal
  // reuses the same ID multiple times
  const diaryEntryElems = Array.from(container.querySelectorAll(
    '[id=diary-table], [id=food]'
  ));
  
  const diaryEntries = removeFalsey(
    diaryEntryElems.map(diaryEntryElem =>
      readDiaryEntry(diaryEntryElem)
    )
  );
  return diaryEntries;
}

/**
 * @param {Element} diaryEntryElem 
 * @returns {DiaryEntry}
 */
function readDiaryEntry(diaryEntryElem) {
  const type = getDiaryType(diaryEntryElem);
  if (!type) return null;
  
  // get the column indexes
  const headerRowElem = diaryEntryElem.querySelector('tr');
  const columns = getDiaryColumns(headerRowElem);
  
  const carbsColumn   = columns.find(column => column.name === 'carbs'  );
  const fiberColumn   = columns.find(column => column.name === 'fiber'  );
  const fatColumn     = columns.find(column => column.name === 'fat'    );
  const proteinColumn = columns.find(column => column.name === 'protein');
  
  // read the meals
  const meals = readMeals(diaryEntryElem, columns);
}

/**
 * @param {Element} diaryEntryElem 
 * @returns {DiaryType}
 */
function getDiaryType(diaryEntryElem) {
  switch (diaryEntryElem && diaryEntryElem.id) {
    case 'diary-table': return 'full';
    case 'food'       : return 'printable';
    default           : return null;
  }
}

/**
 * @param {Element} headerRowElem 
 * @returns {DiaryColumn[]}
 */
function getDiaryColumns(headerRowElem) {
  if (!headerRowElem) return [];
  
  const headerCellElems = Array.from(headerRowElem.querySelectorAll('td'));
  
  const columns = [];
  const startColumnIndex = 1; // skip first column
  for (let i = startColumnIndex; i < headerCellElems.length; ++i) {
    const headerCellElem = headerCellElems[i];
    
    // normalize name: use lowercase of first word
    const match = /\w+/.exec(headerCellElem.innerText);
    const name = (match? match[0] : '').toLowerCase();
    
    columns.push({
      name,
      index: i,
      headerCellElem
    });
  }
  
  return columns;
}

/**
 * @param {Element} diaryEntryElem 
 * @param {DiaryColumn} columns 
 */
function readMeals(diaryEntryElem, columns) {
  // get all rows
  const rowElems = Array.from(diaryEntryElem.querySelectorAll('tr'));
  
  // group the rows by meal
  let mealRowGroups = [];
  let cMealRowGroup = null;
  for (const rowElem in rowElems) {
    const isHeaderRow = (
      rowElem.classList.contains('meal_header') ||
      rowElem.classList.contains('title')
    );
    const isFooterRow = rowElem.classList.contains('bottom');
    
    if (isHeaderRow) {
      cMealRowGroup = {
        headerRowElem: rowElem,
        footerRowElem: null,
        foodRowElems: []
      };
      mealRowGroups.push(cMealRowGroup);
      continue;
    }
    
    if (!cMealRowGroup) {
      // rows before the first meal header row are ignored
      continue;
    }
    
    if (isFooterRow) {
      cMealRowGroup.footerRowElem = rowElem;
      continue;
    }
    
    cMealRowGroup.foodRowElems.push(rowElem);
  }
  
  const meals = removeFalsey(
    mealRowGroups.map(({headerRowElem, footerRowElem, foodRowElems}) =>
      readMeal(headerRowElem, footerRowElem, foodRowElems, columns)
    )
  );
  return meals;
}

/**
 * @param {Element} headerRowElem 
 * @param {Element} footerRowElem 
 * @param {Element[]} foodRowElems 
 * @param {DiaryColumn[]} columns 
 * @returns {Meal}
 */
function readMeal(headerRowElem, footerRowElem, foodRowElems, columns) {
  // get name from the first column in the header row
  const name = headerRowElem.querySelector('td').innerText.trim();
  
  // read each food row
  const foods = removeFalsey(
    foodRowElems.map(foodRowElem =>
      readFood(foodRowElem, columns)
    )
  );
  
  const meal = {
    name,
    foods,
    headerRowElem,
    footerRowElem,
    foodRowElems,
  };
  return meal;
}

/**
 * @param {Element} foodRowElem 
 * @param {DiaryColumn[]} columns 
 */
function readFood(foodRowElem, columns) {
  
}


/**
 * @template T
 * @param {T[]} arr 
 * @returns {T[]}
 */
function removeFalsey(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr.filter(x => x);
}