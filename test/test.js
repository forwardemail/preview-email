const fs = require('node:fs');
const path = require('node:path');
const test = require('ava');
const nodemailer = require('nodemailer');
const previewEmail = require('..');

const transport = nodemailer.createTransport({ jsonTransport: true });

test('returns function', (t) => {
  t.true(typeof previewEmail === 'function');
});

test('opens a preview email', async (t) => {
  const message = {
    from: 'linus <linus+from@gmail.com>',
    to: 'linus+to@gmail.com, linus <linus+test@gmail.com>',
    subject: 'Hello world',
    html: `<p>Hello world</p>`,
    text: 'Hello world',
    replyTo: 'linus <linus+replyto@gmail.com>',
    inReplyTo: 'in reply to',
    attachments: [
      { filename: 'hello-world.txt', content: 'Hello world' },
      { path: path.join(__dirname, '..', '.editorconfig') },
      { path: path.join(__dirname, '..', 'media', 'browser.png') },
      {
        filename: 'test.txt',
        content: fs.createReadStream(path.join(__dirname, 'test.txt'))
      }
    ],
    headers: {
      'X-Some-Custom-Header': 'Some Custom Value'
    },
    list: {
      unsubscribe: 'https://linus.com/unsubscribe'
    }
  };
  const response = await transport.sendMail(message);
  const url = await previewEmail(JSON.parse(response.message));
  t.true(typeof url === 'string');
});

test('returns HTML only', async (t) => {
  const message = {
    from: 'linus <linus+from@gmail.com>',
    to: 'linus+to@gmail.com, linus <linus+test@gmail.com>',
    subject: 'Hello world',
    html: `<p>Hello world</p>`,
    text: 'Hello world',
    replyTo: 'linus <linus+replyto@gmail.com>',
    inReplyTo: 'in reply to',
    attachments: [
      { filename: 'hello-world.txt', content: 'Hello world' },
      { path: path.join(__dirname, '..', '.editorconfig') },
      { path: path.join(__dirname, '..', 'media', 'browser.png') },
      {
        filename: 'test.txt',
        content: fs.createReadStream(path.join(__dirname, 'test.txt'))
      }
    ],
    headers: {
      'X-Some-Custom-Header': 'Some Custom Value'
    },
    list: {
      unsubscribe: 'https://linus.com/unsubscribe'
    }
  };
  const response = await transport.sendMail(message);
  const html = await previewEmail(JSON.parse(response.message), {
    returnHTML: true
  });
  t.true(html.startsWith('<!DOCTYPE html>'));
});

test('does not open', async (t) => {
  const url = await previewEmail({}, { open: false });
  t.true(typeof url === 'string');
});

test('invalid message', async (t) => {
  const error = await t.throwsAsync(previewEmail(false));
  t.is(error.message, 'Message argument is required');
});

test('custom id', async (t) => {
  const id = Date.now().toString();
  const url = await previewEmail({}, { id, open: false });
  t.is(path.basename(url).replace('.html', ''), id);
});

test('does not open in browser', async (t) => {
  const url = await previewEmail({}, { open: false });
  t.true(typeof url === 'string');
});

test('transform URL', async (t) => {
  const url = await previewEmail(
    {},
    {
      open: false,
      urlTransform: (path) => `http://localhost:8000/${path}`
    }
  );
  t.regex(url, /^http:\/\/localhost:8000\//);
});
