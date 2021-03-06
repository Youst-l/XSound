'use strict';

import { SoundModule } from '../SoundModule';
import { VocalCanceler } from './VocalCanceler';

/**
 * This subclass defines properties for playing the single audio.
 * This class creates audio player that has higher features than `HTMLAudioElment`.
 * But, this class is disadvantage to play the many one shot audios.
 * In the case of that, developer should use `OneshotModule`.
 * @constructor
 * @extends {SoundModule}
 */
export class AudioModule extends SoundModule {
    /**
     * @param {AudioContext} context This argument is in order to use the interfaces of Web Audio API.
     * @param {number} bufferSize This argument is buffer size for `ScriptProcessorNode`.
     */
    constructor(context, bufferSize) {
        super(context, bufferSize);

        this.source = context.createBufferSource();  // for the instance of `AudioBufferSourceNode`
        this.buffer = null;                          // for the instance of `AudioBuffer`

        this.currentTime = 0;

        this.paused = true;

        this.callbacks = {
            'decode' : () => {},
            'ready'  : () => {},
            'start'  : () => {},
            'stop'   : () => {},
            'update' : () => {},
            'ended'  : () => {},
            'error'  : () => {}
        };

        this.vocalcanceler = new VocalCanceler();
    }

    /**
     * This method sets callback functions.
     * @param {string|object} key This argument is property name.
     *     This argument is pair of property and value in the case of associative array.
     * @param {function} value This argument is callback function.
     * @return {AudioModule} This is returned for method chain.
     * @override
     */
    setup(key, value) {
        if (Object.prototype.toString.call(arguments[0]) === '[object Object]') {
            // Associative array
            for (const k in arguments[0]) {
                this.setup(k, arguments[0][k]);
            }
        } else {
            const k = String(key).replace(/-/g, '').toLowerCase();

            if (k in this.callbacks) {
                if (Object.prototype.toString.call(value) === '[object Function]') {
                    this.callbacks[k] = value;
                }
            }
        }

        this.envelopegenerator.setGenerator(0);
        this.envelopegenerator.param({
            'attack'  : 0,
            'decay'   : 0.01,
            'sustain' : 1,
            'release' : 0.01
        });

        return this;
    }

    /**
     * This method is getter or setter for parameters.
     * @param {string|object} key This argument is property name in the case of string type.
     *     This argument is pair of property and value in the case of associative array.
     * @param {number|boolean} value This argument is the value of designated property. If this argument is omitted, This method is getter.
     * @return {number|AudioModule} This is returned as the value of designated property in the case of getter. Otherwise, this is returned for method chain.
     * @override
     */
    param(key, value) {
        if (Object.prototype.toString.call(arguments[0]) === '[object Object]') {
            // Associative array
            for (const k in arguments[0]) {
                this.param(k, arguments[0][k]);
            }
        } else {
            const k = String(key).replace(/-/g, '').toLowerCase();

            const r = super.param(k, value);

            if (r !== undefined) {
                return r;
            }

            let v   = 0;
            let min = 0;
            let max = 0;

            switch (k) {
                case 'playbackrate':
                    if (value === undefined) {
                        return this.source.playbackRate.value;
                    }

                    v   = parseFloat(value);
                    min = 0;
                    max = 1024;

                    if ((v >= min) && (v <= max)) {
                        this.source.playbackRate.value = v;

                        const startTime   = this.context.currentTime;
                        const currentTime = this.param('currentTime');
                        const duration    = this.param('duration');

                        this.envelopegenerator.start(startTime);
                        this.envelopegenerator.stop((startTime + ((duration - currentTime) / v)), true);
                    }

                    break;
                case 'loop'   :
                case 'looping':
                    if (value === undefined) {
                        return this.source.loop;
                    }

                    this.source.loop = Boolean(value);

                    break;
                case 'currenttime':
                    if (value === undefined) {
                        return this.currentTime;
                    }

                    if (this.buffer instanceof AudioBuffer) {
                        v   = parseFloat(value);
                        max = this.buffer.duration;
                        min = 0;

                        if ((v >= min) && (v <= max)) {
                            if (this.paused) {
                                this.currentTime = v;
                            } else {
                                this.stop();
                                this.start(v);
                            }
                        }
                    } else {
                        this.currentTime = 0;
                    }

                    break;
                case 'duration':
                    return (this.buffer instanceof AudioBuffer) ? this.buffer.duration : 0;  // Getter only
                case 'samplerate':
                    return (this.buffer instanceof AudioBuffer) ? this.buffer.sampleRate : this.sampleRate;  // Getter only
                case 'channels':
                    return (this.buffer instanceof AudioBuffer) ? this.buffer.numberOfChannels : 0;  // Getter only
                default:
                    break;
            }
        }

        return this;
    }

    /**
     * This method creates the instance of `AudioBuffer` from `ArrayBuffer` or sets the instanceof `AudioBuffer`.
     * @param {ArrayBuffer|AudioBuffer} buffer This argument is the instance of `ArrayBuffer` or `AudioBuffer`.
     * @return {AudioModule} This is returned for method chain.
     * @override
     */
    ready(buffer) {
        if (buffer instanceof ArrayBuffer) {
            this.buffer = null;

            const successCallback = b => {
                this.buffer = b;

                this.analyser.start('timeoverview', 0, this.buffer);
                this.analyser.start('timeoverview', 1, this.buffer);

                this.callbacks.ready(this.buffer);
            };

            this.context.decodeAudioData(buffer, successCallback, this.callbacks.error);

            this.callbacks.decode(buffer);
        } else if (buffer instanceof AudioBuffer) {
            this.buffer = buffer;
        }

        return this;
    }

    /**
     * This method starts audio from the designated time.
     * @param {number} startTime This argument is the time that audio is started at. The default value is 0.
     * @param {number} endTime This argument is the time that audio is ended at. The default value is audio duration.
     * @param {Array.<Effector>} connects This argument is the array for changing the default connection.
     * @param {function} processCallback This argument is in order to change `onaudioprocess` event handler in the instance of `ScriptProcessorNode`.
     * @return {AudioModule} This is returned for method chain.
     * @override
     */
    start(startTime, endTime, connects, processCallback) {
        if ((this.buffer instanceof AudioBuffer) && this.paused) {
            // This value is `AudioContext#currentTime`
            const currentTime = this.context.currentTime;

            const start = parseFloat(startTime);
            const end   = parseFloat(endTime);

            if (end >= 0) {
                this.currentTime = ((start >= 0) && (start <= end)) ? start : 0;
            } else {
                this.currentTime = ((start >= 0) && (start <= this.buffer.duration)) ? start : 0;
            }

            const playbackRate = this.source.playbackRate.value;
            const loop         = this.source.loop;

            this.source = this.context.createBufferSource();

            // for legacy browsers
            this.source.start = this.source.start || this.source.noteGrainOn;
            this.source.stop  = this.source.stop  || this.source.noteOff;

            this.source.buffer             = this.buffer;
            this.source.playbackRate.value = playbackRate;
            this.source.loop               = loop;
            this.source.loopStart          = this.currentTime;
            this.source.loopEnd            = (end >= 0) ? end : this.buffer.duration;

            // AudioBufferSourceNode (Input) -> GainNode (Envelope Generator) -> ScriptProcessorNode -> ... -> AudioDestinationNode (Output)
            this.envelopegenerator.ready(0, this.source, this.processor);
            this.connect(this.processor, connects);

            if (isNaN(start)) {
                this.source.start(currentTime);
            } else if (end >= 0) {
                this.source.start(currentTime, this.currentTime, (end - start));
            } else {
                this.source.start(currentTime, this.currentTime, (this.buffer.duration - this.currentTime));
            }

            this.analyser.start('time');
            this.analyser.start('fft');

            this.paused = false;

            this.envelopegenerator.start(currentTime);

            if (end >= 0) {
                this.envelopegenerator.stop((currentTime + ((end - start) / this.source.playbackRate.value)), true);
            } else {
                this.envelopegenerator.stop((currentTime + ((this.buffer.duration - start) / this.source.playbackRate.value)), true);
            }

            this.on(currentTime);

            this.callbacks.start(this.source, this.currentTime);

            const bufferSize = this.processor.bufferSize;

            if (Object.prototype.toString.call(processCallback) === '[object Function]') {
                this.processor.onaudioprocess = processCallback;
            } else {
                this.processor.onaudioprocess = event => {
                    const inputLs  = event.inputBuffer.getChannelData(0);
                    const inputRs  = event.inputBuffer.getChannelData(1);
                    const outputLs = event.outputBuffer.getChannelData(0);
                    const outputRs = event.outputBuffer.getChannelData(1);

                    if (this.currentTime < Math.floor(this.source.loopEnd)) {
                        for (let i = 0; i < bufferSize; i++) {
                            outputLs[i] = this.vocalcanceler.start(inputLs[i], inputRs[i]);
                            outputRs[i] = this.vocalcanceler.start(inputRs[i], inputLs[i]);

                            this.currentTime += ((1 * this.source.playbackRate.value) / this.source.buffer.sampleRate);

                            this.callbacks.update(this.source, this.currentTime);
                        }

                        this.analyser.domain('timeoverview', 0).update(this.currentTime);
                        this.analyser.domain('timeoverview', 1).update(this.currentTime);
                    } else {
                        if (this.source.loop) {
                            this.stop();

                            if ((this.analyser.domain('timeoverview', 0).param('mode') === 'sprite') || (this.analyser.domain('timeoverview', 1).param('mode') === 'sprite')) {
                                this.start(this.source.loopStart, this.source.loopEnd, connects, processCallback);
                            } else {
                                this.start(0, this.buffer.duration, connects, processCallback);
                            }
                        } else {
                            this.end();
                        }
                    }
                };
            }
        }

        return this;
    }

    /**
     * This method stops audio.
     * @return {AudioModule} This is returned for method chain.
     * @override
     */
    stop() {
        if ((this.buffer instanceof AudioBuffer) && !this.paused) {
            const stopTime = this.context.currentTime;

            this.source.stop(stopTime);

            this.off(stopTime);

            this.analyser.stop('time');
            this.analyser.stop('fft');

            // Clear

            // Stop `onaudioprocess` event
            this.processor.disconnect(0);
            this.processor.onaudioprocess = null;

            this.paused = true;
            this.callbacks.stop(this.source, this.currentTime);
        }

        return this;
    }

    /**
     * This method gets the instance of `AudioBufferSourceNode`.
     * @return {AudioBufferSourceNode}
     * @override
     */
    get() {
        return this.source;
    }

    /**
     * This method starts or stops audio according to audio state.
     * @param {number} startTime This argument is the time that audio is started at. The default value is 0.
     * @param {number} endTime This argument is the time that audio is ended at. The default value is audio duration.
     * @param {Array.<Effector>} connects This argument is the array for changing the default connection.
     * @param {function} processCallback This argument is in order to change `onaudioprocess` event handler in the instance of `ScriptProcessorNode`.
     * @return {AudioModule} This is returned for method chain.
     */
    toggle(startTime, endTime, connects, processCallback) {
        if (this.paused) {
            this.start(startTime, endTime, connects, processCallback);
        } else {
            this.stop();
        }

        return this;
    }

    /**
     * This method rewinds audio.
     * @return {AudioModule} This is returned for method chain.
     */
    end() {
        this.stop();
        this.currentTime = 0;
        this.callbacks.ended(this.source, this.currentTime);

        return this;
    }

    /**
     * This method determines whether the instance of `AudioBuffer` exists.
     * @return {boolean} If the instance of `AudioBuffer` already exists, this value is `true`. Otherwise, this value is `false`.
     */
    isBuffer() {
        return this.buffer instanceof AudioBuffer;
    }

    /**
     * This method determines whether the instance of `AudioBufferSourceNode` exists.
     * @return {boolean} If the instance of `AudioBufferSourceNode` already exists, this value is `true`. Otherwise, this value is `false`.
     */
    isSource() {
        return (this.source instanceof AudioBufferSourceNode) && (this.source.buffer instanceof AudioBuffer);
    }

    /**
     * This method determines whether the audio is paused.
     * @return {boolean} If the audio is paused, this value is `true`. Otherwise, this value is `false`.
     */
    isPaused() {
        return this.paused;
    }

    /**
     * This method is getter or setter for fade-in time.
     * @param {number} time This argument is fade-in time. If this argument is omitted, This method is getter.
     * @return {number|AudioModule} This is returned as fade-in time. Otherwise, this is returned for method chain.
     */
    fadeIn(time) {
        if (time === undefined) {
            return this.envelopegenerator.param('attack');
        }

        this.envelopegenerator.param('attack', time);

        const startTime    = this.context.currentTime;
        const currentTime  = this.param('currentTime');
        const duration     = this.param('duration');
        const playbackRate = this.param('playbackRate');

        this.envelopegenerator.start(startTime);
        this.envelopegenerator.stop((startTime + ((duration - currentTime) / playbackRate)), true);

        return this;
    }

    /**
     * This method is getter or setter for fade-out time.
     * @param {number} time This argument is fade-out time. If this argument is omitted, This method is getter.
     * @return {number|AudioModule} This is returned as fade-out time. Otherwise, this is returned for method chain.
     */
    fadeOut(time) {
        if (time === undefined) {
            return this.envelopegenerator.param('release');
        }

        this.envelopegenerator.param('release', time);

        const startTime    = this.context.currentTime;
        const currentTime  = this.param('currentTime');
        const duration     = this.param('duration');
        const playbackRate = this.param('playbackRate');

        this.envelopegenerator.start(startTime);
        this.envelopegenerator.stop((startTime + ((duration - currentTime) / playbackRate)), true);

        return this;
    }

    /**
     *  This method slices the instance of `AudioBuffer`.
     *  @param {number} startTime This argument is start time [sec] on `AudioBuffer`.
     *  @param {number} endTime This argument is end time [sec] on `AudioBuffer`.
     *  @return {AudioBuffer} This is returned as sliced `AudioBuffer`.
     */
    slice(startTime, endTime) {
        if (!this.isBuffer()) {
            return null;
        }

        const {
            sampleRate,
            length,
            numberOfChannels
        } = this.buffer;

        let start = Math.floor(startTime * sampleRate);
        let end   = Math.floor(endTime * sampleRate);

        if (isNaN(start) || (start < 0)) {
            start = 0;
        }

        if (isNaN(end) || (end > length)) {
            end = length;
        }

        let dataLs = null;
        let dataRs = null;

        if (numberOfChannels > 0) {
            dataLs = this.buffer.getChannelData(0);
        }

        if (numberOfChannels > 1) {
            dataRs = this.buffer.getChannelData(1);
        }

        let bufferLs = null;
        let bufferRs = null;
        let buffer   = null;

        const bufferSize = end - start;

        switch (numberOfChannels) {
            case 1:
                bufferLs = new Float32Array(bufferSize);

                for (let i = start; i < end; i++) {
                    bufferLs[i - start] = dataLs[i];
                }

                buffer = this.context.createBuffer(1, bufferSize, sampleRate);

                buffer.copyToChannel(bufferLs, 0);

                return buffer;
            case 2:
                bufferLs = new Float32Array(bufferSize);
                bufferRs = new Float32Array(bufferSize);

                for (let i = start; i < end; i++) {
                    bufferLs[i - start] = dataLs[i];
                    bufferRs[i - start] = dataRs[i];
                }

                buffer = this.context.createBuffer(2, bufferSize, sampleRate);

                buffer.copyToChannel(bufferLs, 0);
                buffer.copyToChannel(bufferRs, 1);

                return buffer;
            default:
                return null;
        }
    }

    /**
     *  This method sprites audio.
     *  @param {object} sprites This argument is the associative array that contains sprite times.
     *  @return {object} This is returned as the associative array that contains sprited `AudioBuffer`.
     */
    sprite(sprites) {
        if (!this.isBuffer()) {
            return null;
        }

        if (Object.prototype.toString.call(sprites) !== '[object Object]') {
            return null;
        }

        return Object.keys(sprites).reduce((audioBuffers, key) => {
            const times = sprites[key];

            if (!Array.isArray(times) || (times.length !== 2)) {
                return audioBuffers;
            }

            audioBuffers[key] = this.slice(parseFloat(times[0]), parseFloat(times[1]));

            return audioBuffers;
        }, {});
    }

    /** @override */
    params() {
        const params = super.params();

        params.audio = {
            'playbackrate'  : this.isSource() ? this.source.playbackRate.value : 1,
            'vocalcanceler' : {
                'depth' : this.vocalcanceler.param('depth')
            }
        };

        return params;
    }

    /** @override */
    toString() {
        return '[AudioModule]';
    }
}
