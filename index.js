const
	os = require('os'),
	stream = require('stream'),
	util = require('util'),

	binding = require('bindings')('binding'),
	debug = require('debug')('speaker'),

	endianness = os.endianness(),

	DEFAULT_SAMPLES_PER_FRAME = 1024;


module.exports = (function () {
	'use strict';

	function close (speaker, immediate, callback) {

	}

	function formatConstant (formatInfo) {
		if (formatInfo.float) {
			if (formatInfo.bitDepth === 32) {
				return binding.MPG123_ENC_FLOAT_32;
			}

			if (formatInfo.bitDepth === 64) {
				return binding.MPG123_ENC_FLOAT_64;
			}
		}

		if (formatInfo.bitDepth === 8) {
			return formatInfo.signed ?
				binding.MPG123_ENC_SIGNED_8 :
				binding.MPG123_ENC_UNSIGNED_8;
		}

		if (formatInfo.bitDepth === 16) {
			return formatInfo.signed ?
				binding.MPG123_ENC_SIGNED_16 :
				binding.MPG123_ENC_UNSIGNED_16;
		}

		if (formatInfo.bitDepth === 24) {
			return formatInfo.signed ?
				binding.MPG123_ENC_SIGNED_24 :
				binding.MPG123_ENC_UNSIGNED_24;
		}

		if (formatInfo.bitDepth === 32) {
			return formatInfo.signed ?
				binding.MPG123_ENC_SIGNED_32 :
				binding.MPG123_ENC_UNSIGNED_32;
		}

		return null;
	}

	function open (speaker) {

	}

	function prepareOutput (speaker, options) {
		// ensure options
		options = options || {};
		options.lowWaterMark = options.lowWaterMark || 0;
		options.highWaterMark = options.highWaterMark || 0;

		debug('initializeSpeaker(object keys = %o)', Object.keys(options));

		// the `audio_output_t` struct pointer Buffer instance
		speaker._ao = speaker._ao || null;

		// flipped after close() is called, no write() calls allowed after
		speaker._closed = typeof speaker._closed === 'undefined' ?
			false :
			speaker._closed;

		if (options.bitDepth) {
			debug('setting %o: %o', "bitDepth", options.bitDepth);
			speaker.bitDepth = options.bitDepth;
		}

		if (options.channels) {
			debug('setting %o: %o', 'channels', options.channels);
			speaker.channels = options.channels;
		}

		if (!options.endianness || endianness === options.endianness) {
			// no "endianness" specified or explicit native endianness
			speaker.endianness = endianness;
		} else {
			throw new Error(
				util.format(
					'native endianness is %s, but %s was requested"',
					endianness,
					options.endianness));
		}

		if (typeof options.float !== 'undefined' && options.float !== null) {
			debug('setting %o: %o', "float", options.float);
			speaker.float = options.float;
		}

		// Chunks are sent over to the backend in "samplesPerFrame * blockAlign"
		// size. This is necessary because if we send too big of chunks at once,
		// then there won't be any data ready when the audio callback comes
		// (experienced with the CoreAudio backend).
		if (options.samplesPerFrame) {
			debug('setting %o: %o', "samplesPerFrame", options.samplesPerFrame);
			speaker.samplesPerFrame = options.samplesPerFrame;
		} else {
			speaker.samplesPerFrame = DEFAULT_SAMPLES_PER_FRAME;
		}

		if (options.sampleRate) {
			debug('setting %o: %o', "sampleRate", options.sampleRate);
			speaker.sampleRate = options.sampleRate;
		}

		if (typeof options.signed !== 'undefined' || options.signed !== null) {
			debug('setting %o: %o', "signed", options.signed);
			speaker.signed = options.signed;
		}
	}

	function write (speaker, chunk, encoding, done) {
		debug('write() (%o bytes, %o encoding)', chunk.length, encoding);

		if (speaker._closed) {
			// close() has already been called. this should not be called
			return done(new Error('write() call after close() call'));
		}

		let
			bytesRemaining,
			bytesToWrite,
			chunkSize = speaker.blockAlign * speaker.samplesPerFrame,
			handle = speaker._ao,
			writeToHandle = () => {
				if (speaker._closed) {
					debug('aborting remainder of write() call (%o bytes), since speaker is `_closed`', left.length);
					return done();
				}

				bytesToWrite = bytesRemaining;
				if (bytesToWrite.length > chunkSize) {
					let temp = bytesToWrite;
					bytesToWrite = temp.slice(0, chunkSize);
					bytesRemaining = temp.slice(chunkSize);
				} else {
					bytesRemaining = null;
				}

				debug('writing %o bytes', bytesToWrite.length);
				binding.write(handle, bytesToWrite, bytesToWrite.length, (bytesWritten) => {
					debug('wrote %o bytes', bytesWritten);

					if (bytesWritten !== bytesToWrite.length) {
						return done(new Error('write() failed: ' + bytesWritten));
					}

					if (bytesRemaining) {
						debug('%o bytes remaining in this chunk', bytesRemaining.length);
						return writeToHandle();
					}

					debug('done with this chunk');
					return done();
				});
			};

		// ensure we have an audio handle to write to
		if (!handle) {
			try {
				handle = speaker.open();
			} catch (ex) {
				return done(ex);
			}
		}

		// write to the audio handle
		writeToHandle();
	}

	function Speaker (options) {
		if (!new.target) {
			return new Speaker(options);
		}

		let _this = this;

		// call super
		stream.Writable.call(_this, options);

		// initialize properties
		prepareOutput(_this, options);

		// set instances methods
		_this._write = write.bind(_this);
		_this.close = close.bind(_this);
		_this.format = prepareOutput.bind(_this);
		_this.open = open.bind(_this);

		// handle key events
		_this.on('finish', function () {
			debug('finish()');
			_this.close();
		});

		_this.on('pipe', function (source) {
			debug('pipe()');
			prepareOutput(_this, source);
			source.once('format', _this.format);
		});

		_this.on('unpipe', function (source) {
			debug('unpipe()');
			source.removeListener('format', _this.format);
		});
	}

	// inherit from stream.Writable
	util.inherits(Speaker, stream.Writable);

	return {
		backend : binding.name,
		description : binding.description,
		getFormat : formatConstant,
		isSupported : (formatInfo) => {
			return typeof formatInfo === 'number' ?
				binding.formats & format === format :
				formatConstant(formatInfo) !== null;
		},
		Speaker : Speaker,
		version : [binding.api_version, binding.revision].join('.')
	};
}());

/**
 * Closes the audio backend. Normally this function will be called automatically
 * after the audio backend has finished playing the audio buffer through the
 * speakers.
 *
 * @param {Boolean} flush - if `false`, then don't call the `flush()` native binding call. Defaults to `true`.
 * @api public
 */

Speaker.prototype.close = function (immediate, callback) {
	var _this = this;

	if (typeof immediate === 'function') {
		callback = immediate;
		immediate = false;
	}

	callback = callback || function () {};
	immediate = typeof immediate === 'undefined' ? false : immediate;

	debug('close(%o, %o)', immediate, callback);

	if (_this._closed) {
		debug('already closed...');
		return setImmediate(callback);
	}

	if (!_this.audio_handle) {
		debug('not invoking flush() or close() bindings since no `audio_handle`');
		_this._closed = true;
		return setImmediate(callback);
	}

	if (false !== immediate) {
		// TODO: async most likely…
		debug('invoking flush() native binding');

		return binding.flush(_this.audio_handle, function () {
			return _this.close(false, callback);
		});
	}

	debug('invoking close() native binding');
	binding.close(_this.audio_handle, function (r) {
		debug('close result(%o)', r);

		_this.audio_handle = null;
		_this._closed = true;
		_this.emit('close');

		return callback();
	});
};

/**
 * Calls the audio backend's `open()` function, and then emits an "open" event.
 *
 * @api private
 */

Speaker.prototype.open = function () {
	debug('open()');
	if (this.audio_handle) {
		this.emit('error', new Error('open() called more than once!'));
		return;
	}

	// set default options, if not set
	if (null == this.channels) {
		debug('setting default %o: %o', 'channels', 2);
		this.channels = 2;
	}

	if (null == this.bitDepth) {
		var depth = this.float ? 32 : 16;
		debug('setting default %o: %o', 'bitDepth', depth);
		this.bitDepth = depth;
	}

	if (null == this.sampleRate) {
		debug('setting default %o: %o', 'sampleRate', 44100);
		this.sampleRate = 44100;
	}

	if (null == this.signed) {
		debug('setting default %o: %o', 'signed', this.bitDepth != 8);
		this.signed = this.bitDepth != 8;
	}

	var format = exports.getFormat(this);
	if (null == format) {
		this.emit('error', new Error('invalid PCM format specified'));
		return;
	}

	if (!exports.isSupported(format)) {
		this.emit(
			'error',
			new Error('specified PCM format is not supported by "' + binding.name + '" backend'));
		return;
	}

	// calculate the "block align"
	this.blockAlign = this.bitDepth / 8 * this.channels;

	// initialize the audio handle
	// TODO: open async?
	this.audio_handle = new Buffer(binding.sizeof_audio_output_t);
	var r = binding.open(this.audio_handle, this.channels, this.sampleRate, format);
	if (0 !== r) {
		this.emit('error', new Error('open() failed: ' + r));
	}

	this.emit('open');
	return this.audio_handle;
};
