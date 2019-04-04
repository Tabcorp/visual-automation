const _ = require('lodash');
const easyimg = require('easyimage');
const path = require('path');
const fs = require('fs');
const mkdirp = require('mkdirp');
const Q = require('q');
const chalk = require('chalk');
const rimraf = require('rimraf');
const pageObjects = require('../../../node_modules/generic-cucumber-protractor-framework/support/pageObjects');
const general = require('../../../node_modules/generic-cucumber-protractor-framework/support/general');
const ROOT_PATH = path.resolve('./');
const ROOT_PATH_TO_SCREENSHOTS = '/tmp/screenshots/';
const IMAGE_DIFF_THRESHOLD = 0.0017;
const MAX_SCREENSHOT_COMPARE_RETRIES = 5;
const { Before, When, Then } = require('cucumber');
rimraf.sync(ROOT_PATH_TO_SCREENSHOTS + '*');

const printScreenshotMismatchMessage = function (screenshot_file, reference_file, diff_screenshot_file, compare_percent, colour) {
  const reference_file_in_host_machine = reference_file.replace(ROOT_PATH, process.env.HOST_MACHINE_ROOT);
  console.error(colour('\nXXXX Screenshot mismatched! XXXX'));
  console.error(colour(`Reference file: file://${reference_file_in_host_machine}`));
  console.error(colour(`Screenshot file: file://${screenshot_file}`));
  if (fs.existsSync(diff_screenshot_file)) {
    console.error(colour(`Diff image: file://${diff_screenshot_file}`));
  }
  console.error(colour(`Difference : %${compare_percent}`));
  console.error(colour('To update the reference screenshot, run:'));
  console.error(colour(`cp ${screenshot_file} ${reference_file_in_host_machine}`));
};

const printNewScreenshotMessage = function (screenshot_file, reference_file, design_reference) {
  const reference_file_in_host_machine = reference_file.replace(ROOT_PATH, process.env.HOST_MACHINE_ROOT);
  console.error(chalk.red(`A design reference for file://${reference_file_in_host_machine} does not exist.`));
  console.error(chalk.red(`To use the current screenshot, run: cp ${reference_file_in_host_machine} ${reference_file}`));
  console.error(chalk.red(`To verify the screenshot before copying, ctrl+click file://${reference_file_in_host_machine}`));
};

const compare = function (screenshot_file, reference_file, diff_screenshot_file) {
  return easyimg.execute('compare', [
    '-colorspace', 'RGB',
    '-verbose',
    '-metric', 'mae',
    screenshot_file,
    reference_file,
    diff_screenshot_file
  ]);
};

const takeScreenshot = function (location, size, img_path) {
  const deferred = Q.defer();
  browser.takeScreenshot().then(function (png) {
    const temp_img_path = path.join(path.dirname(img_path), '/temp.png');
    mkdirp.sync(path.dirname(img_path));
    fs.writeFileSync(temp_img_path, png, { encoding: 'base64' }, console.log);
    easyimg.crop({
      src: temp_img_path,
      dst: img_path,
      cropwidth: size.width,
      cropheight: size.height,
      x: location.x,
      y: location.y,
      gravity: 'NorthWest'
    }).then(deferred.resolve, function (err, stdout, stderr) {
      deferred.reject(err);
    });
  });
  return deferred.promise;
};

const assertDesignReference = function (location, size, design_reference, retries = 0) {
  const screenshot_dir = fs.mkdtempSync(ROOT_PATH_TO_SCREENSHOTS);
  const screenshot_file = `${screenshot_dir}/${design_reference}`;
  const reference_file = path.join(__dirname, `/../../design_reference/${browser.browserName}/${design_reference}`);
  return takeScreenshot(location, size, screenshot_file).then(function (data) {
    if (!fs.existsSync(reference_file)) {
      mkdirp.sync(path.dirname(reference_file));
      printNewScreenshotMessage(screenshot_file, reference_file, design_reference);
      return false;
    }
    const diff_screenshot_file = screenshot_file.replace(/^(.*)\.png$/, '$1.diff.png');
    return compare(screenshot_file, reference_file, diff_screenshot_file).then(function (stdout) {
      return true;
    }, function (err) {
      const result = err.toString().replace(/\n/g, ' ').replace(/^.*all: [\d\.]+ \((.+)\).*$/, '$1');
      const percentage = (result.search(/^\d+\.\d+/) >= 0 ? parseFloat(result) : 1);
      if (percentage > IMAGE_DIFF_THRESHOLD) {
        if (retries++ >= MAX_SCREENSHOT_COMPARE_RETRIES) {
          console.error('Error comparing screenshot files: ', err);
          printScreenshotMismatchMessage(screenshot_file, reference_file, diff_screenshot_file, percentage, chalk.red);
          return false;
        }
        browser.sleep(1000);
        return assertDesignReference(location, size, design_reference, retries);
      } else if (percentage > 0 && percentage <= IMAGE_DIFF_THRESHOLD * 100) {
        // Let the screenshot test passed, as the difference is within our threshold
        printScreenshotMismatchMessage(screenshot_file, reference_file, diff_screenshot_file, percentage, chalk.yellow);
        return true;
      }
      return false;
    });
  }, function (err) {
    throw new Error(err);
  });
};

// If this doesn't work out, we can bring up the Xnvc window with no cursor
const hideMouseCursor = function () {
  browser.executeScript(function () {
    const mouse_cursor_id = 'mouseCursorAnchor';
    let mouse_cursor_element = document.getElementById(mouse_cursor_id);
    if (mouse_cursor_element == null) {
      const body = document.getElementsByTagName('body')[0];
      const anchor = document.createElement('a');
      anchor.id = mouse_cursor_id;
      anchor.href = '#';
      anchor.style = 'outline-width: 0; position:absolute; top:0; left:0; width:1px; height:1px; z-index: 99999999999999999;';
      body.insertBefore(anchor, body.firstChild);
      mouse_cursor_element = document.getElementById(mouse_cursor_id);
    }
    mouse_cursor_element.focus();
  });
};


const SCREENSHOT_TAG = '@Screenshot';
const PLATFORM_TAGS = ['@desktop', '@tablet', '@mobile'];
let has_screenshot_tag = false;

Before(function (scenario, next) {
  browser.driver.manage().window().getSize().then(function (size) {
    has_screenshot_tag = _.find(scenario.pickle.tags, (tag) => tag.name === SCREENSHOT_TAG);
    const has_platform_tag = _.find(scenario.pickle.tags, (tag) => PLATFORM_TAGS.includes(tag.name));

    // Maximize window for screenshot tests
    if (has_screenshot_tag && !has_platform_tag) {
      browser.driver.manage().window().setSize(1400, 1024);
      browser.driver.manage().window().setPosition(0, 0);
      //browser.driver.manage().window().maximize();
    }
    next();
  });
});

Then(/^the "([^"]*)" will match the design reference "([^"]*)"$/, function (element_name, design_reference, next) {
  if (!has_screenshot_tag) {
    throw new Error('Design reference tests must be tagged with @Screenshot')
  }
  // Don't hide the mouse cursor if we are taking a screenshot of a
  // popup window or dialog box. Focusing the mouse somewhere else may close
  // the dialog or popup window.
  if (!(element_name.search(/(:?popup|dialog)/i) >= 0)) {
    hideMouseCursor();
  }
  const element_selector = pageObjects.elementFor(element_name);
  pageObjects.waitForElementToLoad(element_selector).then(function (current_element) {
    current_element.getSize().then(function (size) {
      current_element.getLocation().then(function (location) {
        assertDesignReference(location, size, design_reference).should.eventually.be.true.and.notify(next);
      });
    });
  });
});

Then(/^I hide the "([^"]*)"$/, function (element_name, next) {
  const element_selector = pageObjects.elementFor(element_name);
  pageObjects.waitForElementToLoad(element_selector)
    .then(function (current_element) {
      browser.executeScript("arguments[0].style.display = 'none';", current_element.getWebElement());
      general.checkElementIsNotDisplayed(element_selector).should.notify(next);
    });
});
