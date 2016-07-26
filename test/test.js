
/**
 * Module dependencies.
 */

var os = require('os');
var assert = require('assert');
var speaker = require('../');
var endianness = 'function' == os.endianness ? os.endianness() : 'LE';
var opposite = endianness == 'LE' ? 'BE' : 'LE';

describe('exports', function () {
  it('should export an Object', function () {
    assert.equal('object', typeof speaker);
    assert.equal('function', typeof speaker.Speaker);
  });

  it('should have a "backend" property', function () {
    assert(speaker.hasOwnProperty('backend'));
    assert('string', typeof speaker.backend);
  });

  it('should have a "description" property', function () {
    assert(speaker.hasOwnProperty('description'));
    assert('string', typeof speaker.description);
  });

  it('should have an "version" property', function () {
    assert(speaker.hasOwnProperty('version'));
    assert('string', typeof speaker.version);
  });
});

describe('Speaker', function () {
  it('should return a Speaker instance', function () {
    var s = new speaker.Speaker();
    assert(s instanceof speaker.Speaker);
  });

  it('should be a writable stream', function () {
    var s = new speaker.Speaker();
    assert.equal(s.writable, true);
    assert.notEqual(s.readable, true);
  });

  it('should emit an "open" event after the first write()', function (done) {
    var s = new speaker.Speaker();
    var called = false;
    s.on('open', function () {
      called = true;
      done();
    });
    assert.equal(called, false);
    s.write(Buffer(0));
  });

  it('should emit a "close" event after end()', function (done) {
    this.slow(1000);
    var s = new speaker.Speaker();
    var called = false;
    s.on('close', function () {
      called = true;
      done();
    });
    assert.equal(called, false);
    s.end(Buffer(0));
  });

  it('should only emit one "close" event', function (done) {
    var s = new speaker.Speaker();
    var count = 0;

    s.on('close', function () {
      count++;
    });

    // force close
    s.end(Buffer(0));

    // try to re-close
    s.close(function (r) {
      assert.equal(1, count);

      done();
    });
  });

  it('should not throw an Error if native "endianness" is specified', function () {
    assert.doesNotThrow(function () {
      new speaker.Speaker({ endianness: endianness });
    });
  });

  it('should throw an Error if non-native "endianness" is specified', function () {
    assert.throws(function () {
      new speaker.Speaker({ endianness: opposite });
    });
  });

  it('should throw an Error if a non-supported "format" is specified', function (done) {
    var s = new speaker.Speaker({
      bitDepth: 31,
      signed: true
    });

    s.once('error', function (err) {
      assert.equal('invalid PCM format specified', err.message);
      done();
    });

    s.open();
  });

});
