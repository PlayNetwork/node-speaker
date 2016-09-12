const
	os = require('os'),
	stream = require('stream'),
	util = require('util'),

	binding = require('bindings')('binding'),
	debug = require('debug')('speaker'),

	endianness = os.endianness(),

	DEFAULT_BIT_DEPTH_8 = 8,
	DEFAULT_BIT_DEPTH_16 = 16,
	DEFAULT_BIT_DEPTH_24 = 24,
	DEFAULT_BIT_DEPTH_32 = 32,
	DEFAULT_BIT_DEPTH_64 = 64,
	DEFAULT_CHANNELS = 2,
	DEFAULT_SAMPLE_RATE = 44100,
	DEFAULT_SAMPLES_PER_FRAME = 1024,
	DEFAULT_WATER_MARK = 0;


module.exports = (function () {
	'use strict';

	function close (speaker, callback) {
		callback = callback || function () {};

		debug('close(%o)', callback);

		if (speaker._closed) {
			debug('already closed...');
			return setImmediate(callback);
		}

		if (!speaker._ao) {
			debug('skipping close() bindings because there is no audio handle');
			speaker._closed = true;
			return setImmediate(callback);
		}

		debug('invoking close() native binding');
		binding.close(speaker._ao, (result) => {
			debug('close result(%o)', result);

			/*eslint no-undefined:0*/
			speaker._ao = undefined;
			speaker._closed = true;
			speaker.emit('close');

			return callback();
		});
	}

	function coalesce () {
		let
			args = Array.prototype.slice.call(arguments),
			value;

		args.some((item) => {
			if (typeof item !== 'undefined' && item !== null) {
				value = item;
			}

			return typeof value === 'boolean' || value;
		});

		return value;
	}

	function flush (speaker, callback) {
		callback = callback || function () {};

		if (!speaker._ao) {
			debug('skipping close() bindings because there is no audio handle');
			return setImmediate(callback);
		}

		debug('invoking flush() native binding');
		binding.flush(speaker._ao, function (result) {
			debug('flush result (%o)', result);

			speaker.emit('flush');
			return close(speaker, callback);
		});
	}

	function formatConstant (formatInfo) {
		if (formatInfo.float) {
			if (formatInfo.bitDepth === DEFAULT_BIT_DEPTH_32) {
				return binding.MPG123_ENC_FLOAT_32;
			}

			if (formatInfo.bitDepth === DEFAULT_BIT_DEPTH_64) {
				return binding.MPG123_ENC_FLOAT_64;
			}
		}

		if (formatInfo.bitDepth === DEFAULT_BIT_DEPTH_8) {
			return formatInfo.signed ?
				binding.MPG123_ENC_SIGNED_8 :
				binding.MPG123_ENC_UNSIGNED_8;
		}

		if (formatInfo.bitDepth === DEFAULT_BIT_DEPTH_16) {
			return formatInfo.signed ?
				binding.MPG123_ENC_SIGNED_16 :
				binding.MPG123_ENC_UNSIGNED_16;
		}

		if (formatInfo.bitDepth === DEFAULT_BIT_DEPTH_24) {
			return formatInfo.signed ?
				binding.MPG123_ENC_SIGNED_24 :
				binding.MPG123_ENC_UNSIGNED_24;
		}

		if (formatInfo.bitDepth === DEFAULT_BIT_DEPTH_32) {
			return formatInfo.signed ?
				binding.MPG123_ENC_SIGNED_32 :
				binding.MPG123_ENC_UNSIGNED_32;
		}

		return null;
	}

	function open (speaker) {
		debug('open()');

		if (speaker._ao) {
			return speaker.emit('error', new Error('open() called more than once!'));
		}

		let
			format = formatConstant(speaker),
			result;

		if (!format) {
			return speaker.emit('error', new Error('invalid PCM format specified'));
		}

		// initialize the audio handle
		speaker._ao = new Buffer(binding.sizeof_audio_output_t);
		result = binding.open(
			speaker._ao,
			speaker.channels,
			speaker.sampleRate,
			format);

		if (result) {
			return speaker.emit(
				'error',
				new Error(util.format('open() failed: %d', result)));
		}

		speaker.emit('open');

		return speaker._ao;
	}

	function prepareOutput (speaker, options) {
		// ensure options
		options = options || {};
		debug('prepareOuput (object keys = %o)', Object.keys(options));

		speaker._ao = speaker._ao || null;
		speaker._closed = coalesce(speaker._closed, false);

		speaker.bitDepth = coalesce(
			options.bitDepth,
			speaker.bitDepth,
			(coalesce(options.float, speaker.float) ?
				DEFAULT_BIT_DEPTH_32 :
				DEFAULT_BIT_DEPTH_16));
		debug('set bitDepth: %o', speaker.bitDepth);

		speaker.channels = coalesce(
			options.channels,
			speaker.channels,
			DEFAULT_CHANNELS);
		debug('set channels: %o', speaker.channels);

		// calculate the "block align"
		speaker.blockAlign = (
			speaker.bitDepth / DEFAULT_BIT_DEPTH_8 * speaker.channels);
		debug('set blockAlign: %o', speaker.blockAlign);

		if (!options.endianness || endianness === options.endianness) {
			// no "endianness" specified or explicit native endianness
			speaker.endianness = endianness;
		} else {
			speaker.emit('error', new Error(
				util.format(
					'native endianness is %s, but %s was requested"',
					endianness,
					options.endianness)));
		}

		speaker.float = coalesce(
			options.float,
			speaker.float);
		debug('set float: %o', speaker.float);

		speaker.highWaterMark = coalesce(
			options.highWaterMark,
			speaker.highWaterMark,
			DEFAULT_WATER_MARK);

		speaker.lowWaterMark = coalesce(
			options.lowWaterMark,
			speaker.lowWaterMark,
			DEFAULT_WATER_MARK);

		// Chunks are sent over to the backend in "samplesPerFrame * blockAlign"
		// size. This is necessary because if we send too big of chunks at once,
		// then there won't be any data ready when the audio callback comes
		// (experienced with the CoreAudio backend).
		speaker.samplesPerFrame = coalesce(
			options.samplesPerFrame,
			speaker.samplesPerFrame,
			DEFAULT_SAMPLES_PER_FRAME);
		debug('set samplesPerFrame: %o', speaker.samplesPerFrame);

		speaker.sampleRate = coalesce(
			options.sampleRate,
			speaker.sampleRate,
			DEFAULT_SAMPLE_RATE);
		debug('set sampleRate: %o', speaker.sampleRate);

		speaker.signed = coalesce(
			options.signed,
			speaker.signed,
			speaker.bitDepth !== DEFAULT_BIT_DEPTH_8);
		debug('set signed: %o', options.signed);
	}

	function write (speaker, chunk, encoding, done) {
		debug('write() (%o bytes, %o encoding)', chunk.length, encoding);

		if (speaker._closed) {
			// close() has already been called
			debug(
				'aborting write() call (%o bytes) - speaker is `_closed`',
				chunk.length);
			return done();
		}

		let
			bytesRemaining = new Buffer(chunk),
			bytesToWrite,
			complete = () => {
				if (done) {
					return done();
				}
			},
			chunkSize = speaker.blockAlign * speaker.samplesPerFrame,
			drain = () => {
				if (bytesRemaining && bytesRemaining.length) {
					//debug('%o bytes remaining in this chunk', bytesRemaining.length);
					return writeToHandle();
				}

				// cleanup the event listener
				speaker.removeListener('drain', drain);

				debug('completed chunk with %o bytes', chunk.length);
				return complete();
			},
			handle = speaker._ao,
			writeToHandle = () => {
				if (speaker._closed) {
					debug(
						'aborting write() call (%o bytes) - speaker is `_closed`',
						bytesRemaining.length);
					return complete();
				}

				bytesToWrite = bytesRemaining;
				if (bytesToWrite.length > chunkSize) {
					let temp = bytesToWrite;
					bytesToWrite = temp.slice(0, chunkSize);
					bytesRemaining = temp.slice(chunkSize);
				} else {
					bytesRemaining = null;
				}

				//debug('writing %o bytes', bytesToWrite.length);
				binding.write(handle, bytesToWrite, bytesToWrite.length, (bytesWritten) => {
					//debug('wrote %o bytes', bytesWritten);

					// handle when not all bytes are written...
					if (bytesWritten !== bytesToWrite.length) {
						speaker.emit(
							'error',
							new Error('write() failed: ' + bytesWritten));
						return complete();
					}

					speaker.emit('drain');
				});
			};

		// ensure we have an audio handle to write to
		if (!handle) {
			try {
				debug('creating _ao because one does not exist');
				handle = speaker.open();
			} catch (ex) {
				return done(ex);
			}
		}

		// setup handling of the drain
		speaker.on('drain', drain);

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
		_this._write = (chunk, encoding, done) => {
			write(_this, chunk, encoding, done);
		};
		_this.close = (callback) => close(_this, callback);
		_this.flush = (callback) => flush(_this, callback);
		_this.format = (options) => prepareOutput(_this, options);
		_this.open = () => open(_this);

		// handle key events
		_this.on('finish', function () {
			debug('finish()');
			_this.close();
		});

		_this.on('pipe', function (source) {
			debug('pipe()');
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
				binding.formats & format :
				formatConstant(formatInfo) !== null;
		},
		Speaker : Speaker,
		version : [binding.api_version, binding.revision].join('.')
	};
}());
