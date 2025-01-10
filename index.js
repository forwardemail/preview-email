const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const process = require('process');
const util = require('util');
const { Buffer } = require('buffer');
const getPort = require('get-port');
const nodemailer = require('nodemailer');
const open = require('open');
const pEvent = require('p-event');
const pWaitFor = require('p-wait-for');
const pug = require('pug');
const uuid = require('uuid');
const { isCI } = require('ci-info');
const { simpleParser } = require('mailparser');

const debug = util.debuglog('preview-email');
const isMacOS = os.platform() === 'darwin';
const writeFile = util.promisify(fs.writeFile);
const transport = nodemailer.createTransport({
  streamTransport: true,
  buffer: true
});
const templateFilePath = path.join(__dirname, 'template.pug');
const renderFilePromise = util.promisify(pug.renderFile);

const previewEmail = async (message, options) => {
  options = {
    dir: os.tmpdir(),
    id: uuid.v4(),
    open: { wait: false },
    template: templateFilePath,
    urlTransform: (path) => `file://${path}`,
    openSimulator: process.env.NODE_ENV !== 'test',
    returnHTML: false,
    // <https://nodemailer.com/extras/mailparser/#options>
    simpleParser: {},
    hasDownloadOriginalButton: true,
    ...options
  };

  debug('message', message, 'options', options);

  let raw;
  let base64;
  if (Buffer.isBuffer(message)) {
    raw = message;
    if (options.hasDownloadOriginalButton) base64 = message.toString('base64');
  } else if (typeof message === 'string') {
    raw = message;
    if (options.hasDownloadOriginalButton)
      base64 = Buffer.from(message).toString('base64');
  } else if (typeof message === 'object') {
    const response = await transport.sendMail(message);
    raw = response.message;
    if (options.hasDownloadOriginalButton)
      base64 = Buffer.from(response.message).toString('base64');
  } else {
    throw new TypeError('Message argument is required');
  }

  const parsed = await simpleParser(raw, options.simpleParser);
  if (options.hasDownloadOriginalButton) parsed.base64 = base64;

  const html = await renderFilePromise(
    options.template,
    Object.assign(parsed, {
      cache: true,
      pretty: true
    })
  );

  const filePath = `${options.dir}/${options.id}.html`;
  const url = options.urlTransform(filePath);

  if (!options.returnHTML) {
    await writeFile(filePath, html);
    if (options.open) await open(url, options.open);
  }

  //
  // if on macOS then send a toast notification about XCode and Simulator for iOS
  // App Store: <https://apps.apple.com/us/app/xcode/id497799835?mt=12>
  // Developer Website: <https://developer.apple.com/download/all/?q=xcode>
  // open -a Simulator
  // `xcrun simctl openurl booted ${url}`
  //
  if (isMacOS && !isCI && options.openSimulator) {
    const { displayNotification } = await import('display-notification');
    try {
      // <https://github.com/sindresorhus/open/blob/05ba9e150cc1a2629e518a9cc19b586c6ca3f269/index.js#L205-L222>
      const simulator = childProcess.spawn('open', ['-a', 'Simulator']);
      await new Promise((resolve, reject) => {
        simulator.once('error', reject);
        simulator.once('close', (exitCode) => {
          if (exitCode !== 0)
            return reject(
              new Error(
                'Install XCode from the macOS App Store or Apple Developer Website to continue.'
              )
            );
          resolve(simulator);
        });
      });

      // wait for the simulator to have been booted
      // xcrun simctl list devices booted -j
      await pWaitFor(async () => {
        const devices = childProcess.spawn('xcrun', [
          'simctl',
          'list',
          'devices',
          'booted',
          '-j'
        ]);
        let stdout = '';
        devices.stdout.on('data', (data) => {
          stdout += data;
        });
        await new Promise((resolve, reject) => {
          devices.once('error', reject);
          devices.once('close', () => {
            resolve();
          });
        });
        let booted = false;
        try {
          const json = JSON.parse(stdout);
          for (const device of Object.keys(json.devices)) {
            for (const output of json.devices[device]) {
              if (output.state === 'Booted') {
                booted = true;
                break;
              }
            }
          }
        } catch (err) {
          debug(err);
        }

        return booted;
      });

      // let done = false;
      const server = http.createServer((req, res) => {
        pEvent(res, 'close').then(() => {
          debug('end');
          // done = true;
        });
        debug('request made');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write(html);
        res.end();
      });
      const port = await getPort();

      await new Promise((resolve, reject) => {
        server.listen(port, (err) => {
          if (err) return reject(err);
          debug('server started');
          resolve();
        });
      });

      const emlFilePath = `${options.dir}/${options.id}.eml`;
      await writeFile(emlFilePath, raw);
      debug('emlFilePath', emlFilePath);
      const xcrun = childProcess.spawn('xcrun', [
        'simctl',
        'openurl',
        'booted',
        emlFilePath
      ]);
      await new Promise((resolve, reject) => {
        xcrun.once('error', reject);
        xcrun.once('close', (exitCode) => {
          if (exitCode === 72)
            return reject(
              new Error(
                `Could not open URL in booted Simulator; make sure Simulator is running.`
              )
            );
          resolve(xcrun);
        });
      });

      /*
      const v = await cryptoRandomString({ length: 10, type: 'alphanumeric' });

      const xcrun = childProcess.spawn('xcrun', [
        'simctl',
        'openurl',
        'booted',
        `http://127.0.0.1:${port}/?v=${v}#html`
      ]);
      await new Promise((resolve, reject) => {
        xcrun.once('error', reject);
        xcrun.once('close', (exitCode) => {
          if (exitCode === 72)
            return reject(
              new Error(
                `Could not open URL in booted Simulator; make sure Simulator is running.`
              )
            );
          resolve(xcrun);
        });
      });

      await pWaitFor(() => done);
      */

      // display notification
      await displayNotification({
        title: 'iOS Simulator Preview',
        subtitle: 'Preview is ready!',
        text: 'Open Simulator to preview and Safari Web Inspector to inspect.',
        sound: 'Bottle'
      });

      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    } catch (err) {
      debug(err);
      // display notification
      await displayNotification({
        title: 'iOS Simulator Preview',
        subtitle: 'Preview emails on iOS',
        text: err.message,
        sound: 'Bottle'
      });
    }
  }

  return options.returnHTML ? html : url;
};

module.exports = previewEmail;
