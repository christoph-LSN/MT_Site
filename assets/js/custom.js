// Add any custom javascript here.

opensdg.tableConfigAlter(function(config) {
    var overrides = {
        "order": [[ 0, "desc" ]]
        "buttons": [[ 'print' ]]
      };
    $.extend(true, config, overrides);
});


////Speakable.js von  https://github.com/tollwerk/speakable

/* eslint no-param-reassign: ["error", { "props": false }] */
(function iffe(w, d) {
    /**
     * Speech Synthesis Voices
     *
     * @type {SpeechSynthesisVoice[]}
     */
    let voices = [];
    /**
     * Global Speech Utterance
     *
     * @type {SpeechSynthesisUtterance}
     */
    let speechUtterance = null;

    /**
     * Regular expression to match punctuation
     *
     * @type {RegExp}
     */
    const punctuation = /[’'‘`“”"[\](){}…,.!;?\-:\u0964\u0965]\s*$/;
    /**
     * Characters that should be stripped from output
     *
     * @type {RegExp}
     */
    const dontspeak = /(\w)[·‧*:](\w)/gi;

    /**
     * Default options
     *
     * @type {{multivoice: boolean, selector: string,
     * l18n: {play: string, stop: string, progress: string, pause: string}}}
     */
    const defaultOptions = {
        selector: '.spkbl',
        local: true,
        multivoice: true,
        src: null,
        hidden: false, // Hide player from assistive technology
        player: null, // Custom player implementation (constructor function name or reference)
        l18n: {
            play: 'Read text',
            pause: 'Pause',
            progress: 'Progress',
            stop: 'Resume'
        }
    };

    /**
     * Block level elements
     *
     * @type {string[]}
     */
    const blockLevelElements = ['address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'dd', 'div', 'dl',
        'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
        'hgroup', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul'];

    /**
     * Test whether an element is a block level element
     *
     * @param {Element} element element
     *
     * @returns {boolean} Is block level element
     */
    function isBlockLevelElement(element) {
        return blockLevelElements.indexOf(element.tagName.toLowerCase()) !== -1;
    }

    /**
     * Simple object check
     *
     * @param item Item
     *
     * @returns {boolean} Is object
     */
    function isObject(item) {
        return (item && typeof item === 'object' && !Array.isArray(item));
    }

    /**
     * Deep merge multiple objects
     *
     * @param target Target object
     * @param sources Source object(s)
     */
    function mergeDeep(target, ...sources) {
        if (!sources.length) {
            return target;
        }
        const source = sources.shift();

        if (isObject(target) && isObject(source)) {
            for (const key in source) {
                if (Object.prototype.hasOwnProperty.call(source, key) && isObject(source[key])) {
                    if (!target[key]) Object.assign(target, { [key]: {} });
                    mergeDeep(target[key], source[key]);
                } else {
                    Object.assign(target, { [key]: source[key] });
                }
            }
        }

        return mergeDeep(target, ...sources);
    }

    /**
     * Cast a value to a Boolean if possible
     *
     * @param {String} val Value
     * @return {boolean|String} Converted value
     */
    function castToBool(val) {
        if ((val === '1') || (val.toLowerCase() === 'true')) {
            return true;
        }
        if ((val === '0') || (val.toLowerCase() === 'false')) {
            return false;
        }
        return val;
    }

    /**
     * Abstract syntax tree parser
     *
     * @param {String} language Language
     * @param {Boolean} multivoice Multiple voices
     *
     * @constructor
     */
    function AstParser(language, multivoice) {
        this.lang = language;
        this.multivoice = multivoice;
        this.items = [];
    }

    /**
     * Recursively parse an element
     *
     * The method recursively traverses the DOM, collects readable elements, determines their language, filters out
     * elements that should be skipped and extracts the readable text. The result is a hierarchichal structure of
     * readable elements, stored in the parser's .items property, somewhat looking like this:
     *
     * items = [
     *     {
     *         lang: "en",
     *         node: text, // DOM node reference
     *         type: 0,
     *         text: "Readable text"
     *     },
     *     {
     *         lang: "en",
     *         node: p, // DOM node reference
     *         type: 2,
     *         items: [...]
     *     },
     *     ...
     * ]
     *
     * The "type" value specifies the item type:
     *
     * 0: Text node
     * 1: Inline element
     * 2: Block element
     *
     * @param {Element} element Element
     *
     * @returns {Object[]} Items
     */
    AstParser.prototype.parse = function parse(element) {
        element.childNodes.forEach(
            (c) => {
                if (c.nodeType === Element.ELEMENT_NODE) {
                    if (!c.hasAttribute('data-spkbl-skip')) {
                        const lang = this.multivoice ? (c.lang || this.lang) : this.lang;
                        this.items.push(
                            {
                                type: 1 + isBlockLevelElement(c),
                                lang,
                                node: c,
                                items: (new AstParser(lang, this.multivoice)).parse(c)
                            }
                        );
                    }
                } else if (c.nodeType === Element.TEXT_NODE) {
                    let text = c.nodeValue;
                    if (text.trim().length) {
                        text = text.replace(/[\s\r\n]+/g, ' ');
                        text = text.replace(dontspeak, '$1$2');
                        this.items.push({
                            type: 0,
                            lang: this.lang,
                            node: c,
                            text
                        });
                    }
                }
            }
        );
        return this.items;
    };

    /**
     * Create a new sentence
     *
     * @param {String} lang Language
     *
     * @return {{chunks: [], lang: *}}
     */
    AstParser.prototype.createSentence = function createSentence(lang) {
        return {
            lang,
            chunks: []
        };
    };

    /**
     * Parse an element into readable chunks
     *
     * @param {Element} element Element
     *
     * @returns {Array} Readable chunks
     * @private
     */
    AstParser.prototype.createChunks = function createChunks(element) {
        const chunks = [];
        let sentence = null;
        const chunksRecursive = (c) => {
            if (sentence === null) {
                sentence = this.createSentence(c.lang);
                if (c.type) {
                    c.items.forEach(chunksRecursive);
                    if (sentence && sentence.chunks.length) {
                        chunks.push(sentence);
                    }
                    sentence = null;
                } else {
                    sentence.chunks.push({
                        node: c.node,
                        text: c.text
                    });
                }
            } else {
                switch (c.type) {
                case 2:
                    if (sentence.chunks.length) {
                        chunks.push(sentence);
                        sentence = this.createSentence(c.lang);
                    } else {
                        sentence.lang = c.lang;
                    }
                    c.items.forEach(chunksRecursive);
                    if (sentence && sentence.chunks.length) {
                        chunks.push(sentence);
                    }
                    sentence = null;
                    break;
                case 1:
                    if (c.node.tagName.toUpperCase() === 'BR') {
                        const clen = sentence.chunks.length;
                        if (clen) {
                            const lastText = sentence.chunks[clen - 1].text;
                            if (!punctuation.test(lastText)) {
                                sentence.chunks.push(
                                    {
                                        node: c.node,
                                        text: ' . '
                                    }
                                );
                            } else if (!/\s$/.test(lastText)) {
                                sentence.chunks.push(
                                    {
                                        node: c.node,
                                        text: ' '
                                    }
                                );
                            }
                        }
                    } else if (c.lang === sentence.lang) {
                        c.items.forEach(chunksRecursive);
                    } else {
                        const { lang } = sentence;
                        if (sentence.chunks.length) {
                            chunks.push(sentence);
                        }
                        sentence = this.createSentence(c.lang);
                        c.items.forEach(chunksRecursive);
                        if (sentence.chunks.length) {
                            chunks.push(sentence);
                        }
                        sentence = this.createSentence(lang);
                    }
                    break;
                default:
                    sentence.chunks.push(
                        {
                            node: c.node,
                            text: c.text
                        }
                    );
                }
            }
        };
        this.parse(element)
            .forEach(chunksRecursive);
        if (sentence && sentence.chunks.length) {
            chunks[chunks.length] = sentence;
        }
        return chunks;
    };

    /**
     * Collapse a chunk's text nodes and build a node source map
     *
     * @param {Object} chunk Chunk
     *
     * @return {{sourcemap: {}, text: string, lang: string}}
     */
    AstParser.prototype.map = function map(chunk) {
        const mappedChunk = {
            lang: chunk.lang,
            text: '',
            map: new Map()
        };
        chunk.chunks.forEach((c) => {
            // const wrap = d.createElementNS('https://tollwerk.de/speakable/1.0', 's:s');
            // c.node.after(wrap);
            // wrap.appendChild(c.node);
            // mappedChunk.map.set(mappedChunk.text.length, wrap);
            mappedChunk.map.set(mappedChunk.text.length, c.node);
            mappedChunk.text += c.text;
        });
        return mappedChunk;
    };

    /**
     * Parse an element and return consolidated readable chunks
     *
     * @param {Element} element Element
     *
     * @returns {Array} Readable chunks
     */
    AstParser.prototype.chunked = function chunked(element) {
        const chunks = this.createChunks(element);
        if (!chunks.length) {
            return [];
        }

        // Run through all chunks, collapse the text nodes and build corresponding sourcemaps
        const chunkMaps = chunks.map(this.map);

        const consolidated = [chunkMaps.shift()];
        while (chunkMaps.length) {
            const chunk = chunkMaps.shift();
            const last = consolidated.length - 1;
            if (chunk.lang === consolidated[last].lang) {
                if (!punctuation.test(consolidated[last].text)) {
                    consolidated[last].text += '. ';
                }
                consolidated[last].text = `${consolidated[last].text.trim()} `;
                const offset = consolidated[last].text.length;
                consolidated[last].text += chunk.text;
                chunk.map.forEach((value, key) => {
                    consolidated[last].map.set(offset + key, value);
                });
            } else {
                consolidated.push(chunk);
            }
        }
        return consolidated;
    };

    /**
     * Speakable
     *
     * @param {Element} element Speakable
     * @param {Object} options Options
     *
     * @constructor
     */
    function Speakable(element, options) {
        this.element = element;
        this.options = this.configure(options, 'data-spkbl');
        this.src = null;
        this.audio = null;
        this.utterances = [];
        this.currentUtterance = 0;
        this.length = 0;
        this.offset = 0;
        this.progress = 0;
        this.paused = false;
        this.nextOnResume = false;
        this.player = null;
        this.controls = {};
        let factory = this.defaultPlayer;
        if (this.options.player) {
            if (typeof this.options.player === 'function') {
                factory = this.options.player;
            } else if (typeof w[this.options.player] === 'function') {
                factory = w[this.options.player];
            }
        }

        // If this player should simply play an audio file: Create an audio resource
        if (this.options.src) {
            this.audioReady = false;
            this.audio = new Audio(this.options.src);
            this.audio.addEventListener('loadstart', () => {
                this.audioReady = false;
            });
            this.audio.addEventListener('canplaythrough', () => {
                this.audioReady = true;
            });
            this.audio.addEventListener('error', () => {
                this.audio = null;
            });
        }

        // Build the player
        this.buildPlayer(factory);

        // Text-to-speech: Parse the element contents
        const astParser = new AstParser(this.determineLanguage(this.element) || 'en', this.options.multivoice);
        this.setUtterances(astParser.chunked(this.element));

        // Inject the player
        this.injectPlayer();
    }

    /**
     * Configure this instance by data attributes
     *
     * @param {Object} options Options
     * @param {String} prefix Attribute prefix
     *
     * @private
     */
    Speakable.prototype.configure = function configure(options, prefix) {
        const configured = {};
        for (const o in options) {
            if (Object.prototype.hasOwnProperty.call(options, o)) {
                const attr = `${prefix}-${o}`;
                if (isObject(options[o])) {
                    configured[o] = this.configure(options[o], attr);
                } else if (this.element.hasAttribute(attr)) {
                    configured[o] = castToBool(this.element.getAttribute(attr));
                } else {
                    configured[o] = options[o];
                }
            }
        }
        return configured;
    };

    /**
     * Determine element language
     *
     * @param {Element} element Element
     *
     * @private
     */
    Speakable.prototype.determineLanguage = function determineLanguage(element) {
        const { lang } = element;
        return lang || (element.parentNode ? this.determineLanguage(element.parentNode) : null);
    };

    /**
     * Create the default player
     *
     * @param {Speakable} spkbl Speakable reference
     * @return {Object} Player elements
     * @private
     */
    Speakable.prototype.defaultPlayer = function defaultPlayer(spkbl) {
        const player = {
            player: d.createElement('div'),
            controls: {}
        };
        player.controls.play = player.player.appendChild(d.createElement('button'));
        player.controls.play.innerHTML = spkbl.options.l18n.play;
        player.controls.pause = player.player.appendChild(d.createElement('button'));
        player.controls.pause.innerHTML = spkbl.options.l18n.pause;
        player.controls.progress = player.player.appendChild(d.createElement('progress'));
        player.controls.progress.innerHTML = '0%';
        player.controls.stop = player.player.appendChild(d.createElement('button'));
        player.controls.stop.innerHTML = spkbl.options.l18n.stop;
        return player;
    };

    /**
     * Build the player
     *
     * @param {Function} factory Player factory
     * @private
     */
    Speakable.prototype.buildPlayer = function buildPlayer(factory) {
        const instance = factory(this);
        this.player = instance.player;
        this.controls = instance.controls;

        this.player.classList.add('spkbl-player', 'spkbl-player--inactive');
        this.player.role = 'group';
        if (this.options.hidden) {
            this.player.setAttribute('aria-hidden', 'true');
        }

        // Play button
        this.controls.play.type = 'button';
        this.controls.play.classList.add('spkbl-ctrl', 'spkbl-ctrl--play');
        this.controls.play.addEventListener('click', this.play.bind(this));

        // Pause button
        this.controls.pause.type = 'button';
        this.controls.pause.classList.add('spkbl-ctrl', 'spkbl-ctrl--pause');
        this.controls.pause.addEventListener('click', this.pause.bind(this));
        this.controls.pause.setAttribute('aria-pressed', 'false');

        // Progress bar
        this.controls.progress.classList.add('spkbl-ctrl', 'spkbl-ctrl--progress');
        this.controls.progress.max = '100';
        this.controls.progress.value = '0';
        this.controls.progress.setAttribute('aria-label', this.options.l18n.progress);
        this.controls.progress.setAttribute('aria-valuenow', '0');
        this.controls.progress.setAttribute('aria-valuemin', '0');
        this.controls.progress.setAttribute('aria-valuemax', '100');
        this.controls.progress.setAttribute('role', 'progressbar');

        // Stop button
        this.controls.stop.type = 'button';
        this.controls.stop.classList.add('spkbl-ctrl', 'spkbl-ctrl--stop');
        this.controls.stop.addEventListener('click', this.stop.bind(this));
    };

    /**
     * Start playing
     *
     * @param {Array} utterances Utterances
     *
     * @private
     */
    Speakable.prototype.setUtterances = function setUtterances(utterances) {
        this.length = 0;
        this.utterances = utterances.map(
            (u) => {
                u.length = u.text.length;
                this.length += u.length + 1;
                return u;
            }
        );
        this.length += 1;
    };

    /**
     * Start playing
     *
     * @param {SpeechSynthesisEvent} e Event
     */
    Speakable.prototype.play = function play(e) {
        if (Speakable.current) {
            Speakable.current.halt();
        }
        Speakable.current = this;

        this.player.classList.add('spkbl-player--active');
        this.player.classList.remove('spkbl-player--inactive');
        this.controls.pause.focus();
        d.addEventListener('keyup', this.escape.bind(this));

        this.currentUtterance = -1;
        this.offset = 0;
        this.progress = 0;

        // If an audio file should be played
        if (this.audio && this.audioReady) {
            this.audio.ontimeupdate = this.boundary.bind(this);
            this.audio.onended = this.next.bind(this);
        } else {
            speechSynthesis.cancel();
            speechUtterance.onboundary = this.boundary.bind(this);
            speechUtterance.onend = this.next.bind(this);
        }

        this.next(e);
    };

    /**
     * Escape the player
     *
     * @param {KeyboardEvent} e Event
     */
    Speakable.prototype.escape = function escape(e) {
        const evt = e || window.event;
        if (('key' in evt) ? (evt.key === 'Escape' || evt.key === 'Esc') : (evt.keyCode === 27)) {
            this.stop();
        }
    };

    /**
     * Play the next utterance
     *
     * @param {SpeechSynthesisEvent} e Event
     */
    Speakable.prototype.next = function next(e) {
        if (this.paused) {
            this.nextOnResume = true;
            speechSynthesis.cancel();
        } else if (this.audio && !this.audio.ended) {
            this.audio.play();
        } else if (!this.audio && (this.utterances.length > (this.currentUtterance + 1))) {
            if (this.currentUtterance >= 0) {
                this.offset += this.utterances[this.currentUtterance].length + 1;
            }
            this.currentUtterance += 1;
            const utterance = this.utterances[this.currentUtterance];
            speechUtterance.text = utterance.text;
            speechUtterance.voice = this.getUtteranceVoice(utterance);
            speechSynthesis.speak(speechUtterance);
        } else {
            this.stop(e);
        }
    };

    /**
     * Find the voice for an utterance
     *
     * @param {Object} utterance Utterance
     *
     * @returns {SpeechSynthesisVoice} Voice
     *
     * @private
     */
    Speakable.prototype.getUtteranceVoice = function getUtteranceVoice(utterance) {
        if (!utterance.voice) {
            const locale = utterance.lang;
            const lang = locale.split('-')
                .shift();
            utterance.voice = voices.find((v) => (v.lang === locale) || (v.lang === lang)
                    || v.lang.startsWith(`${locale}-`) || v.lang.startsWith(`${lang}-`))
                || voices.find((v) => v.default) || voices[0];
        }
        return utterance.voice;
    };

    /**
     * Boundary handler
     *
     * @param {SpeechSynthesisEvent} e Event
     */
    Speakable.prototype.boundary = function boundary(e) {
        if (this.audio) {
            this.progress = Number.isNaN(this.audio.duration) ? 0
                : Math.round(100 * (this.audio.currentTime / this.audio.duration));
        } else {
            this.progress = Math.round((100 * (this.offset + e.charIndex)) / this.length);
        }

        this.updateProgress();
        // console.debug(this.progress, e.name, speechUtterance.text.substr(e.charIndex, e.charLength));
    };

    /**
     * Update the progress bar
     */
    Speakable.prototype.updateProgress = function updateProgress() {
        this.controls.progress.value = this.progress;
        this.controls.progress.setAttribute('aria-valuenow', this.progress);
        this.controls.progress.textContent = `${this.progress} % `;
    };

    /**
     * Pause / Resume playing
     */
    Speakable.prototype.pause = function pause() {
        if (this.audio) {
            this.audio[this.togglePause(this.paused) ? 'pause' : 'play']();
        } else {
            speechSynthesis[this.togglePause(this.paused) ? 'pause' : 'resume']();
            if (this.nextOnResume) {
                this.nextOnResume = false;
                this.next();
            }
        }
    };

    /**
     * Toggle pause button
     *
     * @var {Boolean} paused Is paused
     *
     * @return {Boolean} Is paused
     */
    Speakable.prototype.togglePause = function togglePause(paused) {
        this.paused = !paused;
        this.player.classList[paused ? 'remove' : 'add']('spkbl-player--paused');
        this.controls.pause.setAttribute('aria-pressed', paused ? 'false' : 'true');
        return this.paused;
    };

    /**
     * Stop playing and reset player
     */
    Speakable.prototype.stop = function stop() {
        this.halt();
        this.controls.play.focus();
    };

    /**
     * Stop playing
     */
    Speakable.prototype.halt = function halt() {
        if (this.audio) {
            this.audio.ontimeupdate = null;
            this.audio.onended = null;
            this.audio.load();
        } else {
            speechUtterance.onboundary = null;
            speechUtterance.onend = null;
            speechSynthesis.cancel();
        }
        this.togglePause(true);
        d.removeEventListener('keyup', this.escape.bind(this));

        this.player.classList.add('spkbl-player--inactive');
        this.player.classList.remove('spkbl-player--active');
        this.player.classList.remove('spkbl-player--paused');

        this.progress = 0;
        this.updateProgress();
    };

    /**
     * Inject the player
     *
     * @private
     */
    Speakable.prototype.injectPlayer = function injectPlayer() {
        if (typeof this.options.insert === 'function') {
            this.options.insert(this.element, this.player);
            return;
        }
        switch (this.options.insert) {
        case 'before':
            this.element.parentNode.insertBefore(this.player, this.element);
            break;
        case 'after':
            this.element.parentNode.insertBefore(this.player, this.element.nextSibling);
            break;
        default:
            this.element.insertBefore(this.player, this.element.firstChild);
        }
    };

    /**
     * Currently active player
     *
     * @type {Speakable}
     */
    Speakable.current = null;

    /**
     * Initialize all speakables
     *
     * @param {Object} options Options
     *
     * @returns {Array} Speakables
     */
    Speakable.init = function init(options = {}) {
        // If the Web Speech API is supported
        if ('SpeechSynthesisUtterance' in w) {
            // Prepare the options
            const opts = mergeDeep(defaultOptions, options);
            const selector = opts.selector || '';
            delete opts.selector;

            // Prepare the voices
            speechUtterance = new SpeechSynthesisUtterance();
            speechUtterance.volume = 1;
            speechUtterance.pitch = 1;
            speechUtterance.rate = 1;
            voices = speechSynthesis.getVoices().filter((v) => !opts.local || v.localService);

            // Safari iOS doesn't support the addEventListener() method for the speechSynthesis
            if (speechSynthesis.addEventListener) {
                speechSynthesis.addEventListener('voiceschanged', () => {
                    voices = speechSynthesis.getVoices().filter((v) => !opts.local || v.localService);
                });
            }

            return selector.length ? Array.from(d.querySelectorAll(selector)).map((s) => new Speakable(s, opts)) : [];
        }

        return [];
    };

    if (typeof exports !== 'undefined') {
        exports.Speakable = Speakable;
    } else {
        w.Speakable = Speakable;
    }
}(typeof global !== 'undefined' ? global : window, document));
