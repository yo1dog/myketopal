// ==UserScript==
// @name          MyKetoPal
// @namespace     http://yo1.dog
// @version       1.0.2
// @description   Optimizes MyFitnessPal for a Ketogenic diet
// @author        Mike "yo1dog" Moore
// @homepageURL   https://github.com/yo1dog/myketopal#readme
// @icon          https://github.com/yo1dog/myketopal/raw/master/icon.ico
// @match         *://www.myfitnesspal.com/food/diary*
// @match         *://www.myfitnesspal.com/reports/printable_diary*
// @run-at        document-end
// ==/UserScript==

/* global google */

/**
 * @typedef {'full'|'printable'} DiaryType
 * 
 * @typedef DiaryTable
 * @property {DiaryType}                  type
 * @property {DiaryColumn[]}              columns
 * @property {DiaryColumn | null}         carbsColumn
 * @property {DiaryColumn | null}         fiberColumn
 * @property {DiaryColumn | null}         fatColumn
 * @property {DiaryColumn | null}         proteinColumn
 * @property {DiaryColumn | null}         netCarbsColumn
 * @property {Meal[]}                     meals
 * @property {Nutrient[] | null}          totalNutrients
 * @property {Nutrient[] | null}          goalNutrients
 * @property {Nutrient[] | null}          remainingNutrients
 * @property {HTMLTableElement}           tableElem
 * @property {HTMLTableRowElement | null} headerRowElem
 * @property {HTMLTableRowElement | null} totalsRowElem
 * @property {HTMLTableRowElement | null} goalRowElem
 * @property {HTMLTableRowElement | null} remainingRowElem
 * @property {HTMLTableRowElement | null} footerRowElem
 * 
 * @typedef DiaryColumn
 * @property {string}                      name
 * @property {number}                      index
 * @property {HTMLTableCellElement | null} headerCellElem
 * 
 * @typedef Meal
 * @property {string | null}              name
 * @property {Food[]}                     foods
 * @property {Nutrient[] | null}          totalNutrients
 * @property {HTMLTableRowElement}        headerRowElem
 * @property {HTMLTableRowElement | null} totalsRowElem
 * 
 * @typedef Food
 * @property {string}              name
 * @property {Nutrient[]}          nutrients
 * @property {HTMLTableRowElement} rowElem
 * 
 * @typedef Nutrient
 * @property {DiaryColumn | null}   column
 * @property {string}               valueStr
 * @property {number | null}        value
 * @property {string | null}        percentageStr
 * @property {number | null}        percentage
 * @property {HTMLTableCellElement} cellElem
 * @property {Element}              valueElem
 * @property {Element | null}       percentageElem
 */

let __execIdSeq = 0;

// run the script on the page
(async function runScript() {
  await execOnPage(customEventPolyfill);
  await execOnPage(myKetoPal);
})().catch(err => {
  console.error(err);
});


function myKetoPal() {
// ==================================================
// ==================================================
// myKetoPal start
// ==================================================
// ==================================================


/** @type {Promise<void> | null} */
let googleAPIPromise = null;

(async function run() {
  
  googleAPIPromise = loadGoogleAPI();
  
  // get all the diary tables on the page
  const diaryTables = getDiaryTables(document);
  
  for (const diaryTable of diaryTables) {
    // insert net carbs column
    const netCarbColumnIndex = (
      diaryTable.carbsColumn? diaryTable.carbsColumn.index + 1 :
      2
    );
    insertDiaryNetCarbsColumn(diaryTable, netCarbColumnIndex);
    
    // hide carbs column
    if (diaryTable.carbsColumn) {
      hideDiaryColumn(diaryTable, diaryTable.carbsColumn.index);
    }
    
    // add total calorie percentages
    insertTotalCaloriePercentages(diaryTable);
  }
  
  // insert graphs (do this last because it is async)
  for (const diaryTable of diaryTables) {
    await insertGraphs(diaryTable);
  }
})();

async function loadGoogleAPI() {
  const script = document.createElement('script');
  script.setAttribute('async', '');
  script.setAttribute('src', '//www.gstatic.com/charts/loader.js');
  document.body.appendChild(script);
  
  await new Promise(resolve => script.addEventListener('load', resolve, {once: true}));
  await google.charts.load('current', {packages: ['corechart']});
}

/**
 * @param {Document | Element} container
 * @returns {DiaryTable[]} 
 */
function getDiaryTables(container) {
  // NOTE: we use the [id=] selector instead of # because MyFitnessPal
  // reuses the same ID multiple times
  /** @type {HTMLTableElement[]} */
  const diaryTableElems = Array.from(container.querySelectorAll(`
    [id=diary-table],
    [id=food]
  `));
  
  const diaryTables = removeFalsey(
    diaryTableElems.map(diaryTableElem =>
      readDiaryTable(diaryTableElem)
    )
  );
  return diaryTables;
}

/**
 * @param {HTMLTableElement} diaryTableElem 
 * @returns {DiaryTable | null}
 */
function readDiaryTable(diaryTableElem) {
  const type = getDiaryType(diaryTableElem);
  if (!type) return null;
  
  // get the column indexes
  const headerRowElem = diaryTableElem.querySelector('tr');
  const columns = getDiaryColumns(headerRowElem);
  
  const carbsColumn    = columns.find(column => column.name === 'carbs'  ) || null;
  const fiberColumn    = columns.find(column => column.name === 'fiber'  ) || null;
  const fatColumn      = columns.find(column => column.name === 'fat'    ) || null;
  const proteinColumn  = columns.find(column => column.name === 'protein') || null;
  /** @type {DiaryColumn | null} */
  const netCarbsColumn = null;
  
  // separate the rows
  /** @type {HTMLTableRowElement[]}      */ let mealRowElems     = [];
  /** @type {HTMLTableRowElement | null} */ let totalsRowElem    = null;
  /** @type {HTMLTableRowElement | null} */ let goalRowElem      = null;
  /** @type {HTMLTableRowElement | null} */ let remainingRowElem = null;
  /** @type {HTMLTableRowElement | null} */ let footerRowElem    = null;
  
  if (type === 'full') {
    /** @type {HTMLTableRowElement[]} */
    const rowElems = Array.from(diaryTableElem.querySelectorAll('tbody tr'));
    for (const rowElem of rowElems) {
      if (rowElem.classList.contains('spacer')) {
        continue;
      }
      if (rowElem.classList.contains('total')) {
        if (rowElem.classList.contains('alt')) {
          goalRowElem = rowElem;
        }
        else if (rowElem.classList.contains('remaining')) {
          remainingRowElem = rowElem;
        }
        else {
          totalsRowElem = rowElem;
        }
      }
      else {
        mealRowElems.push(rowElem);
      }
    }
    
    footerRowElem = diaryTableElem.querySelector('tfoot tr');
  }
  else if (type === 'printable') {
    mealRowElems = Array.from(diaryTableElem.querySelectorAll('tbody tr'));
    totalsRowElem = diaryTableElem.querySelector('tfoot tr');
  }
  
  // read the meals
  const meals = readMeals(mealRowElems, columns);
  
  // read the footer row nutrients
  const totalNutrients     = totalsRowElem   ? readRowNutrients(totalsRowElem,    columns) : null;
  const goalNutrients      = goalRowElem     ? readRowNutrients(goalRowElem,      columns) : null;
  const remainingNutrients = remainingRowElem? readRowNutrients(remainingRowElem, columns) : null;
  
  const diaryTable = {
    type,
    columns,
    carbsColumn,
    fiberColumn,
    fatColumn,
    proteinColumn,
    netCarbsColumn,
    meals,
    totalNutrients,
    goalNutrients,
    remainingNutrients,
    tableElem: diaryTableElem,
    headerRowElem,
    totalsRowElem,
    goalRowElem,
    remainingRowElem,
    footerRowElem
  };
  return diaryTable;
}

/**
 * @param {HTMLTableElement} diaryTableElem 
 * @returns {DiaryType | null}
 */
function getDiaryType(diaryTableElem) {
  switch (diaryTableElem && diaryTableElem.id) {
    case 'diary-table': return 'full';
    case 'food'       : return 'printable';
    default           : return null;
  }
}

/**
 * @param {HTMLTableRowElement | null} headerRowElem 
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
 * @param {HTMLTableRowElement[]} mealRowElems 
 * @param {DiaryColumn[]} columns 
 */
function readMeals(mealRowElems, columns) {
  /**
   * @typedef IMealRowGroup
   * @property {HTMLTableRowElement} headerRowElem
   * @property {HTMLTableRowElement | null} totalsRowElem
   * @property {HTMLTableRowElement[]} foodRowElems
   */
  
  // group the rows by meal
  /** @type {IMealRowGroup[]} */
  const mealRowGroups = [];
  /** @type {IMealRowGroup | null} */
  let cMealRowGroup = null;
  for (const rowElem of mealRowElems) {
    const isHeaderRow = (
      rowElem.classList.contains('meal_header') ||
      rowElem.classList.contains('title')
    );
    const isTotalsRow = rowElem.classList.contains('bottom');
    
    if (isHeaderRow) {
      cMealRowGroup = {
        headerRowElem: rowElem,
        totalsRowElem: null,
        foodRowElems: []
      };
      mealRowGroups.push(cMealRowGroup);
      continue;
    }
    
    if (!cMealRowGroup) {
      // rows before the first meal header row are ignored
      continue;
    }
    
    if (isTotalsRow) {
      cMealRowGroup.totalsRowElem = rowElem;
      continue;
    }
    
    cMealRowGroup.foodRowElems.push(rowElem);
  }
  
  const meals = removeFalsey(
    mealRowGroups.map(({headerRowElem, totalsRowElem, foodRowElems}) =>
      readMeal(headerRowElem, totalsRowElem, foodRowElems, columns)
    )
  );
  return meals;
}

/**
 * @param {HTMLTableRowElement} headerRowElem 
 * @param {HTMLTableRowElement | null} totalsRowElem 
 * @param {HTMLTableRowElement[]} foodRowElems 
 * @param {DiaryColumn[]} columns 
 * @returns {Meal}
 */
function readMeal(headerRowElem, totalsRowElem, foodRowElems, columns) {
  // get name from the first column in the header row
  const headerRowNameElem = headerRowElem && headerRowElem.querySelector('td');
  const name = headerRowNameElem? headerRowNameElem.innerText.trim() : null;
  
  // read each food row
  const foods = removeFalsey(
    foodRowElems.map(foodRowElem =>
      readFood(foodRowElem, columns)
    )
  );
  
  // read the totals row
  const totalNutrients = totalsRowElem? readRowNutrients(totalsRowElem, columns) : null;
  
  const meal = {
    name,
    foods,
    totalNutrients,
    headerRowElem,
    totalsRowElem
  };
  return meal;
}

/**
 * @param {HTMLTableRowElement} foodRowElem 
 * @param {DiaryColumn[]} columns 
 * @returns {Food | null}
 */
function readFood(foodRowElem, columns) {
  if (!foodRowElem) return null;
  
  // first column is the food name
  const cellElems = Array.from(foodRowElem.querySelectorAll('td'));
  const name = cellElems[0].innerText.trim();
  
  const nutrients = readRowNutrients(foodRowElem, columns);
  
  const food = {
    name,
    nutrients,
    rowElem: foodRowElem
  };
  return food;
}

/**
 * @param {HTMLTableRowElement} rowElem 
 * @param {DiaryColumn[]} columns 
 * @returns {Nutrient[]}
 */
function readRowNutrients(rowElem, columns) {
  if (!rowElem) return [];
  
  const cellElems = Array.from(rowElem.querySelectorAll('td'));
  
  // read each nutrient
  /** @type {Nutrient[]} */
  const nutrients = [];
  const startCellIndex = 1; // skip first cell
  for (let i = startCellIndex; i < cellElems.length; ++i) {
    const cellElem = cellElems[i];
    
    const column = columns.find(column => column.index === i) || null;
    
    /** @type {HTMLSpanElement | HTMLTableDataCellElement} */
    const valueElem = cellElem.querySelector('.macro-value') || cellElem;
    const valueStr = valueElem.innerText.trim();
    const value = parseNutrientNumber(valueStr);
    
    /** @type {HTMLSpanElement | null} */
    const percentageElem = cellElem.querySelector('.macro-percentage');
    const percentageStr = percentageElem? percentageElem.innerText.trim() : null;
    const percentage = percentageStr? parseNutrientNumber(percentageStr) : null;
    
    const nutrient = {
      column,
      valueStr,
      value,
      percentageStr,
      percentage,
      cellElem,
      valueElem,
      percentageElem
    };
    nutrients.push(nutrient);
  }
  
  return nutrients;
}

/**
 * @param {string} str 
 * @returns {number | null}
 */
function parseNutrientNumber(str) {
  // check for a floating point number
  // https://www.regular-expressions.info/floatingpoint.html
  const match = /[-+]?[\d,]*\.?\d+/.exec(str);
  if (match) {
    // remove commas and parse as float
    return parseFloat(match[0].replace(/,/g, ''));
  }
  
  /*
  // check if the string is empty or all whitespace
  if (/^\s*$/.test(str)) {
    return 0;
  }
  */
  
  // check for double dash 0 notation (ex: --mg)
  if (/^\s*--[a-zA-Z]*\s*$/.test(str)) {
    return 0;
  }
  
  return null;
}


/**
 * @param {DiaryTable} diaryTable
 * @param {number} [targetColumnIndex]
 * @returns {DiaryColumn}
 */
function insertDiaryNetCarbsColumn(diaryTable, targetColumnIndex = -1) {
  if (targetColumnIndex < 0 || targetColumnIndex > diaryTable.columns.length) {
    targetColumnIndex = diaryTable.columns.length;
  }
  
  /*
  // add a cell to every row
  const rowElems = Array.from(diaryTable.elem.querySelectorAll('tr'));
  for (const rowElem of rowElems) {
    rowElem.insertCell(targetColumnIndex);
  }
  */
  
  // shift columns
  for (const column of diaryTable.columns) {
    if (column.index >= targetColumnIndex) {
      ++column.index;
    }
  }
  
  // create table header cell and column
  const headerTitle = 'nCarbs';
  const unit = 'g';
  
  const netCarbsHeaderCellElem = buildDiaryHeaderCell(
    insertCell(diaryTable.headerRowElem, targetColumnIndex),
    diaryTable.type, headerTitle, unit
  );
  
  /** @type {DiaryColumn} */
  const netCarbsColumn = {
    name: 'net_carbs',
    index: targetColumnIndex,
    headerCellElem: netCarbsHeaderCellElem
  };
  diaryTable.columns.push(netCarbsColumn);
  diaryTable.netCarbsColumn = netCarbsColumn;
  
  let totalNetCarbs = 0;
  
  for (const meal of diaryTable.meals) {
    let mealTotalNetCarbs = 0;
    
    for (const food of meal.foods) {
      // increase colspan for meal header cell
      if (diaryTable.type === 'printable') {
        meal.headerRowElem.cells[0].colSpan++;
      }
      
      // calculate net carbs for food
      const carbs = nanify(getNutrientValue(food.nutrients, diaryTable.carbsColumn));
      const fiber = nanify(getNutrientValue(food.nutrients, diaryTable.fiberColumn));
      
      const netCarbs = Math.max(carbs - fiber, 0);
      mealTotalNetCarbs += netCarbs;
      totalNetCarbs += netCarbs;
      
      // create cell for food nutrient
      food.nutrients.push(
        // @ts-ignore
        buildDiaryNutrientCell(
          insertCell(food.rowElem, netCarbsColumn.index),
          diaryTable.type, netCarbsColumn, netCarbs, null, unit
        )
      );
    }
    
    // create cell for meal total nutrient
    if (meal.totalNutrients) {
      meal.totalNutrients.push(
        // @ts-ignore
        buildDiaryNutrientCell(
          insertCell(meal.totalsRowElem, netCarbsColumn.index),
          diaryTable.type, netCarbsColumn, mealTotalNetCarbs, null, unit
        )
      );
    }
  }
  
  // create cells for footer rows
  const netCarbsGoal = nanify(getNutrientValue(diaryTable.goalNutrients, diaryTable.carbsColumn));
  const netCarbsRemaining = netCarbsGoal - totalNetCarbs;
  
  if (diaryTable.totalNutrients) {
    diaryTable.totalNutrients.push(
      // @ts-ignore
      buildDiaryNutrientCell(
        insertCell(diaryTable.totalsRowElem, netCarbsColumn.index),
        diaryTable.type, netCarbsColumn, totalNetCarbs, null, unit
      )
    );
  }
  
  if (diaryTable.goalNutrients) {
    diaryTable.goalNutrients.push(
      // @ts-ignore
      buildDiaryNutrientCell(
        insertCell(diaryTable.goalRowElem, netCarbsColumn.index),
        diaryTable.type, netCarbsColumn, netCarbsGoal, null, unit
      )
    );
  }
  
  if (diaryTable.remainingNutrients) {
    diaryTable.remainingNutrients.push(
      // @ts-ignore
      buildDiaryNutrientCell(
        insertCell(diaryTable.remainingRowElem, netCarbsColumn.index),
        diaryTable.type, netCarbsColumn, netCarbsRemaining, null, unit, true
      )
    );
  }
  
  buildDiaryHeaderCell(
    insertCell(diaryTable.footerRowElem, netCarbsColumn.index),
    diaryTable.type, headerTitle, unit
  );
  
  return netCarbsColumn;
}

/**
 * @param {HTMLTableCellElement | null} cellElem 
 * @param {DiaryType} diaryType 
 * @param {string} title 
 * @param {string} [unit] 
 * @returns {HTMLTableCellElement | null}
 */
function buildDiaryHeaderCell(cellElem, diaryType, title, unit = '') {
  if (!cellElem) return null;
  
  cellElem.innerText = title;
  
  if (diaryType === 'full') {
    cellElem.classList.add(
      'alt',
      'nutrient-column',
      'show-pointer',
      'is-macro'
    );
    
    const subtitleElem = document.createElement('div');
    subtitleElem.classList.add('subtitle');
    cellElem.appendChild(subtitleElem);
    
    const valueElem = document.createElement('span');
    valueElem.innerText = unit;
    valueElem.classList.add('macro-value');
    subtitleElem.appendChild(valueElem);
    
    const percentageElem = document.createElement('span');
    percentageElem.innerText = '%';
    percentageElem.classList.add('macro-percentage');
    subtitleElem.appendChild(percentageElem);
  }
  
  return cellElem;
}

/**
 * @param {HTMLTableCellElement | null} cellElem 
 * @param {DiaryType} diaryType 
 * @param {DiaryColumn | null} [column] 
 * @param {number | null} [_value] 
 * @param {number | null} [_percentage] 
 * @param {string} [unit] 
 * @param {boolean} [applyPosNeg] 
 * @returns {Nutrient | null}
 */
function buildDiaryNutrientCell(cellElem, diaryType, column = null, _value = null, _percentage = null, unit = '', applyPosNeg = false) {
  if (!cellElem) return null;
  
  const valueStrPrefix = diaryType === 'printable'? unit : '';
  
  let value;
  let valueStr;
  if (_value === null || isNaN(_value)) {
    value = null;
    valueStr = '?';
  }
  else if (typeof _value === 'number') {
    value = _value;
    valueStr = _value.toString() + valueStrPrefix;
  }
  else {
    value = null;
    valueStr = _value === null || typeof _value === 'undefined'? '' : String(value);
  }
  
  let percentage;
  let percentageStr;
  if (_percentage === null || isNaN(_percentage)) {
    percentage = null;
    percentageStr = '?';
  }
  else if (typeof _percentage === 'number') {
    percentage = _percentage;
    percentageStr = _percentage.toString();
  }
  else {
    percentage = null;
    percentageStr = _percentage === null || typeof _percentage === 'undefined'? '' : String(value);
  }
  
  /** @type {HTMLTableCellElement | HTMLSpanElement} */
  let valueElem = cellElem;
  let percentageElem = null;
  
  if (diaryType === 'full') {
    valueElem = document.createElement('span');
    valueElem.innerText = valueStr;
    valueElem.classList.add('macro-value');
    cellElem.appendChild(valueElem);
    
    percentageElem = document.createElement('span');
    percentageElem.innerText = percentageStr || '';
    percentageElem.classList.add('macro-percentage');
    cellElem.appendChild(percentageElem);
  }
  else {
    cellElem.innerText = valueStr;
  }
  
  if (applyPosNeg && typeof value === 'number' && !isNaN(value)) {
    if (value < 0) {
      cellElem.classList.add('negative');
    }
    else {
      cellElem.classList.add('positive');
    }
  }
  
  const nutrient = {
    column,
    valueStr,
    value,
    percentageStr,
    percentage,
    cellElem,
    valueElem,
    percentageElem
  };
  return nutrient;
}

/**
 * @param {HTMLTableRowElement | null} rowElem 
 * @param {number} [index] 
 * @returns {HTMLTableCellElement | null}
 */
function insertCell(rowElem, index = -1) {
  if (!rowElem) return null;
  return rowElem.insertCell(Math.min(index, rowElem.cells.length));
}

/**
 * @param {DiaryTable} diaryTable 
 */
function insertTotalCaloriePercentages(diaryTable) {
  // get the total nutrients for each meal
  /** @type {(Nutrient[] | null)[]} */
  const nutrientsList = [
    diaryTable.totalNutrients,
    diaryTable.goalNutrients
  ].concat(
    diaryTable.meals
    .map(meal => meal.totalNutrients)
  );
  
  for (const nutrients of nutrientsList) {
    const netCarbsNutrient = getNutrient(nutrients, diaryTable.netCarbsColumn);
    const proteinNutrient  = getNutrient(nutrients, diaryTable.proteinColumn);
    const fatNutrient      = getNutrient(nutrients, diaryTable.fatColumn);
    
    const netCarbs = netCarbsNutrient && netCarbsNutrient.value;
    const protein  = proteinNutrient  && proteinNutrient .value;
    const fat      = fatNutrient      && fatNutrient     .value;
    
    if (
      netCarbs === null &&
      protein === null &&
      fat === null
    ) {
      continue;
    }
    
    const carbCals    = nanify(netCarbs) * 4;
    const proteinCals = nanify(protein) * 4;
    const fatCals     = nanify(fat) * 9;
    const totalCals   = carbCals + proteinCals + fatCals;
    
    if (totalCals === 0) {
      continue;
    }
    
    /** @type {[Nutrient | null, number][]} */
    const sets = [
      [netCarbsNutrient, carbCals   ],
      [proteinNutrient,  proteinCals],
      [fatNutrient,      fatCals    ]
    ];
    
    // make all nutrient cells alight to top
    if (nutrients) {
      for (const nutrient of nutrients) {
        nutrient.cellElem.style.verticalAlign = 'top';
      }
    }
    
    // create percentage elements for macro nutrients
    for (const [nutrient, cals] of sets) {
      if (!nutrient) continue;
      
      const prct = roundPrct(cals/totalCals);
      
      const spanElem = document.createElement('span');
      spanElem.innerText = `${isNaN(prct)? '?' : prct}%`;
      spanElem.style.fontStyle = 'italic';
      
      nutrient.cellElem.appendChild(document.createElement('br'));
      nutrient.cellElem.appendChild(spanElem);
    }
  }
}

/**
 * @param {DiaryTable} diaryTable 
 * @param {number} columnIndex 
 */
function hideDiaryColumn(diaryTable, columnIndex) {
  const rowElems = [
    diaryTable.headerRowElem,
    diaryTable.totalsRowElem,
    diaryTable.goalRowElem,
    diaryTable.remainingRowElem,
    diaryTable.footerRowElem,
  ];
  for (const meal of diaryTable.meals) {
    rowElems.push(meal.totalsRowElem);
    
    for (const food of meal.foods) {
      rowElems.push(food.rowElem);
    }
  }
  
  for (const rowElem of rowElems) {
    if (!rowElem) continue;
    
    const cellElem = rowElem.cells[columnIndex];
    if (!cellElem) continue;
    
    cellElem.style.display = 'none';
  }
}

/**
 * @param {DiaryTable} diaryTable 
 */
async function insertGraphs(diaryTable) {
  const graphContainersElem = document.createElement('div');
  
  const calorieGraphContainerElem = document.createElement('div');
  calorieGraphContainerElem.style.cssFloat = 'left';
  calorieGraphContainerElem.style.width = '50%';
  graphContainersElem.append(calorieGraphContainerElem);
  
  const nutrientGraphContainerElem = document.createElement('div');
  nutrientGraphContainerElem.style.cssFloat = 'left';
  nutrientGraphContainerElem.style.width = '50%';
  graphContainersElem.append(nutrientGraphContainerElem);
  
  diaryTable.tableElem.insertAdjacentElement('afterend', graphContainersElem);
  
  await insertKetoCalorieGraph(diaryTable, calorieGraphContainerElem);
  await insertKetoNutrientGraph(diaryTable, nutrientGraphContainerElem);
}

/**
 * @param {DiaryTable} diaryTable 
 * @param {HTMLElement} containerElem 
 * @returns {Promise<any>}
 */
async function insertKetoCalorieGraph(diaryTable, containerElem) {
  await googleAPIPromise;
  
  // get nutrients totals
  const netCarbs = nanify(getNutrientValue(diaryTable.totalNutrients, diaryTable.netCarbsColumn));
  const protein  = nanify(getNutrientValue(diaryTable.totalNutrients, diaryTable.proteinColumn));
  const fat      = nanify(getNutrientValue(diaryTable.totalNutrients, diaryTable.fatColumn));
  
  const carbCals    = netCarbs * 4;
  const proteinCals = protein * 4;
  const fatCals     = fat * 9;
  const totalCals   = carbCals + proteinCals + fatCals;
  
  if (isNaN(totalCals)) {
    containerElem.innerText = 'Unable to load chart: data missing.';
    return;
  }
  if (totalCals === 0) {
    return;
  }
  
  /** @type {Object<string, number>} */
  const rowMap = {
    'Carbs': carbCals,
    'Protein': proteinCals,
    'Fat': fatCals,
  };
  
  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn('string', 'Type');
  dataTable.addColumn('number', 'Cals');
  dataTable.addRows(Object.keys(rowMap).map(label => {
    const cals = rowMap[label];
    const prct = roundPrct(cals/totalCals);
    return [`${label}: ${cals} - ${prct}%`, prct];
  }));
  
  const chart = new google.visualization.PieChart(containerElem);
  chart.draw(dataTable, {
    title: 'Daily Totals by Calories',
    enableInteractivity: false,
    chartArea: {left: 10, right: 20}
  });
  
  return chart;
}

/**
 * @param {DiaryTable} diaryTable 
 * @param {HTMLElement} containerElem
 * @returns {Promise<any>}
 */
async function insertKetoNutrientGraph(diaryTable, containerElem) {
  await googleAPIPromise;
  
  // get nutrients totals
  const netCarbs = nanify(getNutrientValue(diaryTable.totalNutrients, diaryTable.netCarbsColumn));
  const protein  = nanify(getNutrientValue(diaryTable.totalNutrients, diaryTable.proteinColumn));
  const fat      = nanify(getNutrientValue(diaryTable.totalNutrients, diaryTable.fatColumn));
  
  const totalGrams = netCarbs + protein + fat;
  
  if (isNaN(totalGrams)) {
    containerElem.innerText = 'Unable to load chart: data missing.';
    return;
  }
  if (totalGrams === 0) {
    return;
  }
  
  /** @type {Object<string, number>} */
  const rowMap = {
    'Net Carbs': netCarbs,
    'Protein': protein,
    'Fat': fat,
  };
  
  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn('string', 'Type');
  dataTable.addColumn('number', 'Grams');
  dataTable.addRows(Object.keys(rowMap).map(label => {
    const grams = rowMap[label];
    const prct = roundPrct(grams/totalGrams);
    return [`${label}: ${grams}g - ${prct}%`, prct];
  }));
  
  const chart = new google.visualization.PieChart(containerElem);
  chart.draw(dataTable, {
    title: 'Daily Totals by Grams',
    enableInteractivity: false,
    chartArea: {left: 10, right: 20}
  });
  
  return chart;
}

/**
 * @param {Nutrient[] | null} nutrients 
 * @param {DiaryColumn | null} column 
 * @returns {Nutrient | null}
 */
function getNutrient(nutrients, column) {
  if (!nutrients) return null;
  if (!column) return null;
  
  const nutrient = nutrients.find(nutrient => nutrient.column === column);
  if (!nutrient) return null;
  
  return nutrient;
}

/**
 * @param {Nutrient[] | null} nutrients 
 * @param {DiaryColumn | null} column 
 * @returns {number | null}
 */
function getNutrientValue(nutrients, column) {
  const nutrient = getNutrient(nutrients, column);
  if (!nutrient) return null;
  
  return nutrient.value;
}

/**
 * @template T
 * @param {(T | null)[]} arr 
 * @returns {T[]}
 */
function removeFalsey(arr) {
  if (!Array.isArray(arr)) return arr;
  return /** @type {T[]} */(arr.filter(x => x));
}

/**
 * @param {any} val 
 * @returns {number}
 */
function nanify(val) {
  return typeof val === 'number'? val : NaN;
}

/**
 * @param {number} num 
 * @returns {number}
 */
function roundPrct(num) {
  return Math.round(num*100);
}


// ==================================================
// ==================================================
// myKetoPal end
// ==================================================
// ==================================================
}


/**
 * @param {(param?: any) => void} fn 
 * @param {any} [jsonParam] 
 */
async function execOnPage(fn, jsonParam) {
  const execId = __execIdSeq++;
  const eventName = 'exec-on-page-complete';
  
  const script = document.createElement('script');
  script.setAttribute('async', '');
  script.textContent = `
    (async () =>
      await (${fn})(${JSON.stringify(jsonParam)})
    )()
    .then (result => document.dispatchEvent(new CustomEvent(${JSON.stringify(eventName)}, {detail: {id: ${JSON.stringify(execId)}, result}})))
    .catch(error  => document.dispatchEvent(new CustomEvent(${JSON.stringify(eventName)}, {detail: {id: ${JSON.stringify(execId)}, error }})))
  `;
  
  const result = await new Promise((resolve, reject) => {
    /** @type {EventListener} */
    const eventListener = event => {
      if (
        !(event instanceof CustomEvent) ||
        !event.detail ||
        event.detail.id !== execId
      ) {
        return;
      }
      
      document.removeEventListener(eventName, eventListener);
      
      if (event.detail.error) {
        reject(event.detail.error);
        return;
      }
      resolve(event.detail.result);
    };
    
    document.addEventListener(eventName, eventListener);
    document.body.appendChild(script);
  });
  
  document.body.removeChild(script);
  return result;
}

// https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent/CustomEvent#Polyfill
function customEventPolyfill() {
  /* eslint-disable */
  if ( typeof window.CustomEvent === "function" ) return false;

  // @ts-ignore
  function CustomEvent ( event, params ) {
    params = params || { bubbles: false, cancelable: false, detail: null };
    var evt = document.createEvent( 'CustomEvent' );
    evt.initCustomEvent( event, params.bubbles, params.cancelable, params.detail );
    return evt;
  }

  CustomEvent.prototype = window.Event.prototype;

  // @ts-ignore
  window.CustomEvent = CustomEvent;
  /* eslint-enable */
}