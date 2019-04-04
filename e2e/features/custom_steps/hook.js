const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const { After, Status } = require('cucumber');

// After hook for each step
After(function (scenario, next) {
  if (scenario.result.status === Status.FAILED) {
    const scenarioName = scenario.pickle.name;
    browser.takeScreenshot().then(function(png) {
      var scenario_name = scenarioName.replace(/\s+/g,"_");
      var failed_scenario_file =  path.join(__dirname, `/../../reporting/screenshots/${scenario_name}.png`);
      mkdirp.sync(path.dirname(failed_scenario_file));
      fs.writeFileSync(failed_scenario_file, png, { encoding: 'base64' }, console.log);
    }, function (err) {
      throw new Error(err);
    });
  }
  next();
});
