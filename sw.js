// ============================================================
// DIET + WORKOUT PLANNER — Google Apps Script Backend v2
// Deploy as Web App: Execute as "Me", Access "Anyone"
// ============================================================

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

// ============================================================
// SECURITY: API Key
// ============================================================
const API_SECRET_KEY = "MyDietPlan2026!"; // <-- CHANGE THIS

function isAuthorized(e, isPost) {
  var key;
  if (isPost) {
    try { var data = JSON.parse(e.postData.contents); key = data.key; } catch(err) { return false; }
  } else {
    key = e.parameter.key;
  }
  if (key === API_SECRET_KEY) return true;
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Settings");
    var data2 = sheet.getDataRange().getValues();
    for (var i = 1; i < data2.length; i++) {
      if (data2[i][0] === "apiKey" && data2[i][1] === key) return true;
    }
  } catch(err) {}
  return false;
}

function unauthorizedResponse() {
  return ContentService.createTextOutput(JSON.stringify({
    success: false, error: "Unauthorized. Invalid or missing API key."
  })).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// SECURITY: Rate Limiting (100 requests per hour per action)
// ============================================================
function checkRateLimit(action) {
  var cache = CacheService.getScriptCache();
  var rkey = "rate_" + action;
  var count = Number(cache.get(rkey)) || 0;
  if (count >= 100) return false;
  cache.put(rkey, String(count + 1), 3600);
  return true;
}

// ============================================================
// SECURITY: Input Validation
// ============================================================
function validateInput(data) {
  var str = JSON.stringify(data);
  if (str.length > 50000) return {valid: false, error: "Payload too large"};
  if (data.foodName && data.foodName.length > 200) return {valid: false, error: "Food name too long"};
  if (data.desc && data.desc.length > 500) return {valid: false, error: "Description too long"};
  if (data.notes && data.notes.length > 1000) return {valid: false, error: "Notes too long"};
  if (data.skipReason && data.skipReason.length > 200) return {valid: false, error: "Skip reason too long"};

  var fields = ["foodName", "desc", "notes", "skipReason", "workoutName"];
  for (var i = 0; i < fields.length; i++) {
    var val = data[fields[i]];
    if (val && typeof val === "string") {
      if (val.indexOf("<script") > -1 || val.indexOf("javascript:") > -1 || val.indexOf("eval(") > -1) {
        return {valid: false, error: "Invalid characters in " + fields[i]};
      }
    }
  }

  var numFields = ["cal", "protein", "carbs", "fat", "burn", "weight", "waist", "energy", "sleep", "nausea", "hunger", "mood", "water"];
  for (var j = 0; j < numFields.length; j++) {
    var nv = data[numFields[j]];
    if (nv !== undefined && nv !== null && nv !== "") {
      if (isNaN(Number(nv))) return {valid: false, error: numFields[j] + " must be a number"};
      if (Number(nv) > 99999) return {valid: false, error: numFields[j] + " value too large"};
    }
  }

  if (data.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return {valid: false, error: "Invalid date format"};
  }

  return {valid: true};
}

// ============================================================
// SETUP: Run this ONCE to create all tabs
// ============================================================
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = getOrCreateSheet(ss, "DailyLog");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Date","Day","MealSlot","FoodId","FoodName","Description","Calories","Protein","Carbs","Fat","Skipped","SkipReason","Timestamp"]);
    sheet.setFrozenRows(1);
    sheet.getRange("1:1").setFontWeight("bold").setBackground("#1e3a5f").setFontColor("#ffffff");
  }

  sheet = getOrCreateSheet(ss, "WorkoutLog");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Date","Day","WorkoutId","WorkoutName","Duration","CaloriesBurned","Intensity","Notes","Timestamp"]);
    sheet.setFrozenRows(1);
    sheet.getRange("1:1").setFontWeight("bold").setBackground("#2d6a4f").setFontColor("#ffffff");
  }

  sheet = getOrCreateSheet(ss, "WeightLog");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Date","Weight_kg","Waist_cm","Chest_cm","Hip_cm","EnergyLevel","SleepQuality","NauseaLevel","HungerLevel","Mood","WaterIntake_L","Notes","Timestamp"]);
    sheet.setFrozenRows(1);
    sheet.getRange("1:1").setFontWeight("bold").setBackground("#7c3aed").setFontColor("#ffffff");
  }

  sheet = getOrCreateSheet(ss, "FoodMenu");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["SlotKey","FoodId","Name","Description","Calories","Protein","Carbs","Fat","IsActive"]);
    sheet.setFrozenRows(1);
    sheet.getRange("1:1").setFontWeight("bold").setBackground("#d97706").setFontColor("#ffffff");
  }

  sheet = getOrCreateSheet(ss, "WorkoutMenu");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["WorkoutId","Name","Icon","Duration","CaloriesBurned","Intensity","Steps","Color","Border","IsActive"]);
    sheet.setFrozenRows(1);
    sheet.getRange("1:1").setFontWeight("bold").setBackground("#dc2626").setFontColor("#ffffff");
    seedWorkoutMenu(sheet);
  }

  sheet = getOrCreateSheet(ss, "Settings");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Key","Value"]);
    sheet.setFrozenRows(1);
    sheet.getRange("1:1").setFontWeight("bold").setBackground("#475569").setFontColor("#ffffff");
    var settings = [
      ["calorieTarget","1600"],["proteinTarget","110"],["carbTarget","165"],["fatTarget","50"],
      ["levoTime","6:30 AM"],["breakfastTime","7:30 AM"],["injectionDay","friday"],
      ["noEatAfter","8:30 PM"],["currentWeight","108"],["targetWeight","88"],
      ["zepboundDose","5mg"],["userName",""],["apiKey","MyDietPlan2026!"],["apiKeyLastChanged","2026-03-23"]
    ];
    settings.forEach(function(s) { sheet.appendRow(s); });
  }

  sheet = getOrCreateSheet(ss, "WeeklySummary");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["WeekStart","WeekEnd","AvgCalories","AvgProtein","TotalWorkoutBurn","AvgWeight","MealsSkipped","WorkoutsCompleted","Notes"]);
    sheet.setFrozenRows(1);
    sheet.getRange("1:1").setFontWeight("bold").setBackground("#059669").setFontColor("#ffffff");
  }

  SpreadsheetApp.getUi().alert("Setup complete! All tabs created.");
}

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function seedWorkoutMenu(sheet) {
  var workouts = [
    ["w1","Road Biking","🚴","45-60 min",450,"High","Warm-up 5 min easy spin | Main 35-45 min moderate (15-18 mph) | 3-4 hill intervals | Cool-down 5 min + stretch","#fee2e2","#fca5a5","TRUE"],
    ["w2","Tennis","🎾","60 min",420,"High","Warm-up 5 min light rally | Groundstroke drills 15 min | Serve practice 10 min | Match play 25 min | Cool-down stretch","#fce7f3","#f9a8d4","TRUE"],
    ["w3","Hybrid Bike","🚲","40-50 min",320,"Moderate","Warm-up 5 min easy | Main 30-40 min steady (12-15 mph) | Mix road + trail | Cool-down 5 min + stretch","#dbeafe","#93c5fd","TRUE"],
    ["w4","Skipping / Jump Rope","🪢","20-25 min",280,"High","Warm-up 2 min light bounce | 1 min skip/30s rest x5 | 30s fast/30s rest x5 | 1 min alternating x3 | Cool-down stretch","#fef3c7","#fde68a","TRUE"],
    ["w5","Freestyle Bodyweight","💪","30-40 min",220,"Moderate","Warm-up 3 min | Push-ups 3x12 | Squats 3x15 | Lunges 3x10 each | Plank 3x30s | Mountain climbers 3x15 | Burpees 3x8 | Cool-down 5 min","#d1fae5","#6ee7b7","TRUE"],
    ["w6","Active Recovery Walk","🚶","30 min",120,"Low","Brisk walk 25 min | Light stretching 5 min | Focus posture and breathing | Good for post-injection days","#f1f5f9","#cbd5e1","TRUE"],
    ["w7","Yoga + Flexibility","🧘","30 min",100,"Low","Sun salutations 5 rounds | Hip flexor stretch | Hamstring stretch | Cat-cow 10 reps | Pigeon pose | Deep breathing 5 min","#ede9fe","#c4b5fd","TRUE"],
    ["w8","Rest Day","😴","--",0,"Rest","Complete rest | Gentle walk if feeling okay | Hydration 3L+ | Light stretching if desired","#fef3c7","#fde68a","TRUE"]
  ];
  workouts.forEach(function(w) { sheet.appendRow(w); });
}

// ============================================================
// API: doGet
// ============================================================
function doGet(e) {
  if (!isAuthorized(e, false)) return unauthorizedResponse();
  if (!checkRateLimit("get_" + (e.parameter.action || "unknown"))) {
    return ContentService.createTextOutput(JSON.stringify({success:false,error:"Rate limited. Try again later."})).setMimeType(ContentService.MimeType.JSON);
  }

  var action = e.parameter.action;
  var result;
  try {
    // Special case: getHealthSimple returns plain text directly
    if (action === "getHealthSimple") {
      return getHealthSimple(e.parameter.date);
    }
    switch(action) {
      case "getMenu": result = getMenu(); break;
      case "getWorkouts": result = getWorkoutMenu(); break;
      case "getSettings": result = getSettings(); break;
      case "getDailyLog": result = getDailyLog(e.parameter.date); break;
      case "getWorkoutLog": result = getWorkoutLog(e.parameter.date); break;
      case "getDayFull": result = getDayFull(e.parameter.date); break;
      case "getWeekFull": result = getWeekFull(e.parameter.weekStart); break;
      case "getWeightLog": result = getWeightLog(e.parameter.startDate, e.parameter.endDate); break;
      case "getHealthExport": result = getHealthExport(e.parameter.date); break;
      case "getDashboard": result = getDashboard(); break;
      default: result = {error: "Unknown action: " + action};
    }
  } catch(err) { result = {error: err.toString()}; }

  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// API: doPost
// ============================================================
function doPost(e) {
  if (!isAuthorized(e, true)) return unauthorizedResponse();
  if (!checkRateLimit("post")) {
    return ContentService.createTextOutput(JSON.stringify({success:false,error:"Rate limited. Try again later."})).setMimeType(ContentService.MimeType.JSON);
  }

  var data;
  try { data = JSON.parse(e.postData.contents); }
  catch(err) { return ContentService.createTextOutput(JSON.stringify({error:"Invalid JSON"})).setMimeType(ContentService.MimeType.JSON); }

  var validation = validateInput(data);
  if (!validation.valid) {
    return ContentService.createTextOutput(JSON.stringify({success:false,error:validation.error})).setMimeType(ContentService.MimeType.JSON);
  }

  if (data.meals && Array.isArray(data.meals)) {
    if (data.meals.length > 20) {
      return ContentService.createTextOutput(JSON.stringify({success:false,error:"Too many meals"})).setMimeType(ContentService.MimeType.JSON);
    }
    for (var mi = 0; mi < data.meals.length; mi++) {
      var mv = validateInput(data.meals[mi]);
      if (!mv.valid) {
        return ContentService.createTextOutput(JSON.stringify({success:false,error:"Meal "+mi+": "+mv.error})).setMimeType(ContentService.MimeType.JSON);
      }
    }
  }

  var result;
  try {
    switch(data.action) {
      case "logMeal": result = logMeal(data); break;
      case "logWorkout": result = logWorkout(data); break;
      case "logWeight": result = logWeight(data); break;
      case "logFullDay": result = logFullDay(data); break;
      case "updateSetting": result = updateSetting(data.key2 || data.settingKey, data.value); break;
      case "addFoodItem": result = addFoodItem(data); break;
      case "addWorkoutItem": result = addWorkoutItem(data); break;
      default: result = {error: "Unknown action: " + data.action};
    }
  } catch(err) { result = {error: err.toString()}; }

  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// GET FUNCTIONS
// ============================================================
function getMenu() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("FoodMenu");
  var data = sheet.getDataRange().getValues();
  var menu = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[8].toString().toUpperCase() !== "TRUE") continue;
    var slot = row[0];
    if (!menu[slot]) menu[slot] = [];
    menu[slot].push({id:row[1], name:row[2], desc:row[3], cal:row[4], p:row[5], c:row[6], f:row[7]});
  }
  return {success:true, menu:menu};
}

function getWorkoutMenu() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("WorkoutMenu");
  var data = sheet.getDataRange().getValues();
  var workouts = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[9].toString().toUpperCase() !== "TRUE") continue;
    workouts.push({id:row[0], name:row[1], icon:row[2], dur:row[3], burn:row[4], intensity:row[5], items:row[6].split(" | "), color:row[7], border:row[8]});
  }
  return {success:true, workouts:workouts};
}

function getSettings() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Settings");
  var data = sheet.getDataRange().getValues();
  var settings = {};
  for (var i = 1; i < data.length; i++) { settings[data[i][0]] = data[i][1]; }
  return {success:true, settings:settings};
}

function getDailyLog(date) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DailyLog");
  var data = sheet.getDataRange().getValues();
  var logs = [];
  for (var i = 1; i < data.length; i++) {
    if (formatDate(data[i][0]) === date) {
      logs.push({date:date, day:data[i][1], slot:data[i][2], foodId:data[i][3], foodName:data[i][4], desc:data[i][5], cal:data[i][6], protein:data[i][7], carbs:data[i][8], fat:data[i][9], skipped:data[i][10], skipReason:data[i][11]});
    }
  }
  return {success:true, date:date, meals:logs};
}

function getWorkoutLog(date) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("WorkoutLog");
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (formatDate(data[i][0]) === date) {
      return {success:true, date:date, workout:{id:data[i][2], name:data[i][3], duration:data[i][4], burn:data[i][5], intensity:data[i][6], notes:data[i][7]}};
    }
  }
  return {success:true, date:date, workout:null};
}

function getDayFull(date) {
  var dailyLog = getDailyLog(date);
  var workoutLog = getWorkoutLog(date);
  return {success:true, date:date, meals:dailyLog.meals, workout:workoutLog.workout};
}

function getWeekFull(weekStart) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mealData = ss.getSheetByName("DailyLog").getDataRange().getValues();
  var woData = ss.getSheetByName("WorkoutLog").getDataRange().getValues();

  var endDate = new Date(weekStart + "T12:00:00");
  endDate.setDate(endDate.getDate() + 6);
  var end = formatDate(endDate);

  var weekMeals = {};
  for (var i = 1; i < mealData.length; i++) {
    var d = formatDate(mealData[i][0]);
    if (d >= weekStart && d <= end) {
      if (!weekMeals[d]) weekMeals[d] = [];
      weekMeals[d].push({slot:mealData[i][2], foodId:mealData[i][3], foodName:mealData[i][4], desc:mealData[i][5], cal:mealData[i][6], protein:mealData[i][7], carbs:mealData[i][8], fat:mealData[i][9], skipped:mealData[i][10], skipReason:mealData[i][11]});
    }
  }

  var weekWorkouts = {};
  for (var j = 1; j < woData.length; j++) {
    var wd = formatDate(woData[j][0]);
    if (wd >= weekStart && wd <= end) {
      weekWorkouts[wd] = {id:woData[j][2], name:woData[j][3], duration:woData[j][4], burn:woData[j][5], intensity:woData[j][6], notes:woData[j][7]};
    }
  }

  var days = [];
  for (var k = 0; k < 7; k++) {
    var dt = new Date(weekStart + "T12:00:00");
    dt.setDate(dt.getDate() + k);
    var dd = formatDate(dt);
    var meals = weekMeals[dd] || [];
    var cal = 0, protein = 0, carbs = 0, fat = 0, skipped = 0;
    meals.forEach(function(m) {
      if (m.skipped && m.skipped.toString().toUpperCase() === "TRUE") skipped++;
      else { cal += Number(m.cal) || 0; protein += Number(m.protein) || 0; carbs += Number(m.carbs) || 0; fat += Number(m.fat) || 0; }
    });
    days.push({date:dd, day:getDayName(dt), meals:meals, workout:weekWorkouts[dd] || null, totalCal:cal, totalProtein:protein, totalCarbs:carbs, totalFat:fat, skippedCount:skipped, workoutBurn:weekWorkouts[dd] ? Number(weekWorkouts[dd].burn) || 0 : 0});
  }

  return {success:true, weekStart:weekStart, days:days};
}

function getWeightLog(startDate, endDate) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("WeightLog");
  var data = sheet.getDataRange().getValues();
  var logs = [];
  for (var i = 1; i < data.length; i++) {
    var d = formatDate(data[i][0]);
    if ((!startDate || d >= startDate) && (!endDate || d <= endDate)) {
      logs.push({date:d, weight:data[i][1], waist:data[i][2], chest:data[i][3], hip:data[i][4], energy:data[i][5], sleep:data[i][6], nausea:data[i][7], hunger:data[i][8], mood:data[i][9], water:data[i][10], notes:data[i][11]});
    }
  }
  return {success:true, logs:logs};
}

function getHealthExport(date) {
  date = date || formatDate(new Date());
  var dailyLog = getDailyLog(date);
  var totalCal = 0, totalProtein = 0, totalCarbs = 0, totalFat = 0;
  (dailyLog.meals || []).forEach(function(m) {
    if (m.skipped && m.skipped.toString().toUpperCase() === "TRUE") return;
    totalCal += Number(m.cal) || 0;
    totalProtein += Number(m.protein) || 0;
    totalCarbs += Number(m.carbs) || 0;
    totalFat += Number(m.fat) || 0;
  });

  var workoutLog = getWorkoutLog(date);
  var activeEnergy = 0, workoutName = "", workoutDuration = "";
  if (workoutLog.workout) {
    activeEnergy = Number(workoutLog.workout.burn) || 0;
    workoutName = workoutLog.workout.name || "";
    workoutDuration = workoutLog.workout.duration || "";
  }

  var weightSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("WeightLog");
  var weightData = weightSheet.getDataRange().getValues();
  var weight = null, waist = null, water = null;
  for (var i = 1; i < weightData.length; i++) {
    if (formatDate(weightData[i][0]) === date) {
      weight = weightData[i][1] ? Number(weightData[i][1]) : null;
      waist = weightData[i][2] ? Number(weightData[i][2]) : null;
      water = weightData[i][10] ? Number(weightData[i][10]) : null;
      break;
    }
  }

  return {
    success:true, date:date,
    nutrition:{calories:totalCal, protein:totalProtein, carbs:totalCarbs, fat:totalFat},
    workout:{activeEnergy:activeEnergy, name:workoutName, duration:workoutDuration},
    body:{weight:weight, waist:waist, waterLiters:water},
    shortcuts:{dietaryCalories:totalCal, dietaryProtein:totalProtein, dietaryCarbs:totalCarbs, dietaryFat:totalFat, activeEnergy:activeEnergy, bodyMass:weight, waterMl:water ? Math.round(water * 1000) : null}
  };
}

// Simple flat response for Apple Shortcuts (easier to parse)
function getHealthSimple(date) {
  var full = getHealthExport(date);
  if (!full.success) return full;
  var s = full.shortcuts;
  // Return as flat key=value text — Shortcuts can split by line
  var lines = [
    "cal=" + (s.dietaryCalories || 0),
    "protein=" + (s.dietaryProtein || 0),
    "carbs=" + (s.dietaryCarbs || 0),
    "fat=" + (s.dietaryFat || 0),
    "burn=" + (s.activeEnergy || 0),
    "weight=" + (s.bodyMass || 0),
    "water=" + (s.waterMl || 0)
  ];
  return ContentService.createTextOutput(lines.join("\n")).setMimeType(ContentService.MimeType.TEXT);
}

function getDashboard() {
  var settings = getSettings().settings;
  var today = formatDate(new Date());
  var dailyLog = getDailyLog(today);
  var workoutLog = getWorkoutLog(today);
  var d = new Date();
  d.setDate(d.getDate() - 7);
  var weightLog = getWeightLog(formatDate(d), today);
  var weekDailyLogs = getWeekMealStats(getWeekStart(new Date()));
  return {success:true, today:today, settings:settings, todayMeals:dailyLog.meals, todayWorkout:workoutLog.workout, weightTrend:weightLog.logs, weekStats:weekDailyLogs};
}

function getWeekSummary(weekStart) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("WeeklySummary");
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (formatDate(data[i][0]) === weekStart) {
      return {success:true, summary:{weekStart:weekStart, weekEnd:formatDate(data[i][1]), avgCal:data[i][2], avgProtein:data[i][3], totalBurn:data[i][4], avgWeight:data[i][5], skipped:data[i][6], workouts:data[i][7], notes:data[i][8]}};
    }
  }
  return {success:true, summary:null};
}

// ============================================================
// POST FUNCTIONS
// ============================================================
function logMeal(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DailyLog");
  var date = data.date || formatDate(new Date());
  var day = data.day || getDayName(new Date(date + "T12:00:00"));
  removeExistingRow(sheet, date, data.slot);
  sheet.appendRow([date, day, data.slot, data.foodId, data.foodName, data.desc || "", data.cal || 0, data.protein || 0, data.carbs || 0, data.fat || 0, data.skipped ? "TRUE" : "FALSE", data.skipReason || "", new Date().toISOString()]);
  return {success:true, message:"Meal logged", date:date, slot:data.slot};
}

function logWorkout(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("WorkoutLog");
  var date = data.date || formatDate(new Date());
  var day = data.day || getDayName(new Date(date + "T12:00:00"));
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (formatDate(rows[i][0]) === date) sheet.deleteRow(i + 1);
  }
  sheet.appendRow([date, day, data.workoutId, data.workoutName, data.duration || "", data.burn || 0, data.intensity || "", data.notes || "", new Date().toISOString()]);
  return {success:true, message:"Workout logged", date:date};
}

function logWeight(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("WeightLog");
  var date = data.date || formatDate(new Date());
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (formatDate(rows[i][0]) === date) sheet.deleteRow(i + 1);
  }
  sheet.appendRow([date, data.weight || "", data.waist || "", data.chest || "", data.hip || "", data.energy || "", data.sleep || "", data.nausea || "", data.hunger || "", data.mood || "", data.water || "", data.notes || "", new Date().toISOString()]);
  return {success:true, message:"Weight logged", date:date};
}

function logFullDay(data) {
  var date = data.date || formatDate(new Date());
  var results = [];
  if (data.meals) {
    data.meals.forEach(function(meal) { meal.date = date; results.push(logMeal(meal)); });
  }
  if (data.workout) {
    data.workout.date = date;
    results.push(logWorkout(data.workout));
  }
  return {success:true, message:"Full day logged", date:date, results:results};
}

function updateSetting(key, value) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Settings");
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return {success:true, message:"Setting updated", key:key, value:value};
    }
  }
  sheet.appendRow([key, value]);
  return {success:true, message:"Setting added", key:key, value:value};
}

function addFoodItem(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("FoodMenu");
  sheet.appendRow([data.slot, data.id, data.name, data.desc, data.cal, data.protein, data.carbs, data.fat, "TRUE"]);
  return {success:true, message:"Food item added"};
}

function addWorkoutItem(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("WorkoutMenu");
  sheet.appendRow([data.id, data.name, data.icon, data.duration, data.burn, data.intensity, data.steps, data.color || "#f1f5f9", data.border || "#cbd5e1", "TRUE"]);
  return {success:true, message:"Workout item added"};
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function formatDate(d) {
  if (typeof d === "string") return d;
  var date = new Date(d);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function getDayName(d) {
  return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()];
}

function getWeekStart(d) {
  var date = new Date(d);
  var day = date.getDay();
  var diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return formatDate(date);
}

function removeExistingRow(sheet, date, slot) {
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (formatDate(data[i][0]) === date && data[i][2] === slot) sheet.deleteRow(i + 1);
  }
}

function getWeekMealStats(weekStart) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DailyLog");
  var data = sheet.getDataRange().getValues();
  var endDate = new Date(weekStart);
  endDate.setDate(endDate.getDate() + 6);
  var end = formatDate(endDate);
  var totalCal = 0, totalP = 0, days = {}, skipped = 0;
  for (var i = 1; i < data.length; i++) {
    var d = formatDate(data[i][0]);
    if (d >= weekStart && d <= end) {
      days[d] = true;
      totalCal += Number(data[i][6]) || 0;
      totalP += Number(data[i][7]) || 0;
      if (data[i][10] && data[i][10].toString().toUpperCase() === "TRUE") skipped++;
    }
  }
  var numDays = Object.keys(days).length || 1;
  return {avgCal:Math.round(totalCal / numDays), avgProtein:Math.round(totalP / numDays), daysLogged:numDays, mealsSkipped:skipped};
}

// ============================================================
// WEEKLY SUMMARY TRIGGER (set as weekly trigger on Monday)
// ============================================================
function generateWeeklySummary() {
  var today = new Date();
  var weekStart = getWeekStart(today);
  var weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  var mealStats = getWeekMealStats(weekStart);

  var woSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("WorkoutLog");
  var woData = woSheet.getDataRange().getValues();
  var totalBurn = 0, woCount = 0;
  for (var i = 1; i < woData.length; i++) {
    var d = formatDate(woData[i][0]);
    if (d >= weekStart && d <= formatDate(weekEnd)) {
      totalBurn += Number(woData[i][5]) || 0;
      if (Number(woData[i][5]) > 0) woCount++;
    }
  }

  var wtSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("WeightLog");
  var wtData = wtSheet.getDataRange().getValues();
  var wtSum = 0, wtCount = 0;
  for (var j = 1; j < wtData.length; j++) {
    var wd = formatDate(wtData[j][0]);
    if (wd >= weekStart && wd <= formatDate(weekEnd) && wtData[j][1]) {
      wtSum += Number(wtData[j][1]);
      wtCount++;
    }
  }

  var summarySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("WeeklySummary");
  summarySheet.appendRow([weekStart, formatDate(weekEnd), mealStats.avgCal, mealStats.avgProtein, totalBurn, wtCount > 0 ? Math.round(wtSum / wtCount * 10) / 10 : "", mealStats.mealsSkipped, woCount, ""]);
}
