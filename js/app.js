window.onload = function () {
    window.chrome.webview.addEventListener('sharedbufferreceived', (e) => {
        chrome.webview.hostObjects.sync.foo_uie_webview.print('foo_webview2: JavaScript says hello.');

        document.getElementById('VersionText').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.componentVersionText;

        const Version = chrome.webview.hostObjects.sync.foo_uie_webview.componentVersion;
        document.getElementById('Version').textContent = 'v' + ((Version >> 24) & 255) + '.' + ((Version >> 16) & 255) + '.' + ((Version >> 8) & 255) + '.' + (Version & 255);
        document.getElementById('Volume2').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.volume;
        //chrome.webview.hostObjects.sync.foo_uie_webview.volume = 0; // The volume can be set from code.
        document.getElementById('Mute').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.isMuted ? '\u{1F508}' : '\u{1F507}';
        document.getElementById('ToggleStopAfterCurrent').checked = chrome.webview.hostObjects.sync.foo_uie_webview.stopAfterCurrent;

        document.getElementById('Stop').textContent = '\u23F9';
        document.getElementById('Play').textContent = '\u23F5';
        document.getElementById('Pause').textContent = '\u23F8';
        document.getElementById('Prev').textContent = '\u23EE';
        document.getElementById('Next').textContent = '\u23ED';
        document.getElementById('Random').textContent = '\u{1F500}';
        document.getElementById('VolumeDown').textContent = '\u{1F509}';
        document.getElementById('VolumeUp').textContent = '\u{1F50A}';

        onSharedBufferReceived(e);
    });

    //window.chrome.webview.addEventListener('playlistFocusedItemChanged', () => alert('Focus changed'));

    refresh();

    // After the "sharedbufferreceived" listener is installed, (re)post the current shared buffer.
    // This avoids missing the buffer when it was posted before this script was ready to receive it.
    chrome.webview.hostObjects.sync.foo_uie_webview.requestSharedBuffer();
};

// Broadcasts a notification to the `on_notify_data()` function of all other panels.
window.NotifyOthers = function (name, info) {
    chrome.webview.hostObjects.sync.foo_uie_webview.notifyOthers(name, (typeof info === 'string') ? info : JSON.stringify(info));
};

// Called when another panel broadcasts a notification through `window.NotifyOthers(name, info)`.
function on_notify_data(name, info) {
    // `info` is always received as a string. When the sender serialized structured data with `JSON.stringify()`,
    // deserialize it back into an object with `JSON.parse()`. Fall back to the raw string when it is not valid JSON.
    let data = info;
    try {
        data = JSON.parse(info);
    } catch (e) {
        // `info` was a plain (non-JSON) string; keep it as-is.
    }
    if (data !== null && typeof data === 'object') {
        // Example: the sender called `NotifyOthers('trackInfo', { title: 'Song', artist: 'Band', year: 1900 });`
        chrome.webview.hostObjects.sync.foo_uie_webview.print('foo_uie_webview received object notification "' + name + '": title=' + data.title + ', artist=' + data.artist + ', year=' + data.year);
    } else {
        chrome.webview.hostObjects.sync.foo_uie_webview.print('foo_uie_webview received notification "' + name + '": ' + data);
    }
}

// Demonstration of the foobar2000 façade (see "fb2k.js" and "fb2k.d.ts").
// Subscriptions are additive and do not affect the direct host calls.
if (window.fb2k) {
    fb2k.on('playback:trackChanged', async () => {
        const title = await fb2k.invoke('playback.getFormattedText', { text: '%artist% - %title%' });
        fb2k.invoke('component.print', { text: 'foobar2000 façade: now playing "' + title + '"' });
    });

    fb2k.on('playback:volumeChanged', ({ volume }) => fb2k.invoke('component.print', { text: 'fb2k façade: volume ' + volume + ' dBFS' }));
}

let SharedBuffer;
let Samples;

// Called when playback is being initialized.
function onPlaybackStarting(command, paused) {
    document.getElementById('Info').style.display = 'inline';
    document.getElementById('Starting').textContent = command + ' (' + (paused ? 'Paused' : 'Playing') + ')';

    refreshProperties();
}

// Called when playback advances to a new track.
function onPlaybackNewTrack() {
    document.getElementById('Info').style.display = 'inline';

    refresh();

    const PlaceholderURI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
    const DataURI = chrome.webview.hostObjects.sync.foo_uie_webview.getArtwork('front'); // 'front', 'back', 'disc', 'icon', 'artist'
    document.getElementById('Artwork').src = (DataURI.length != 0) ? DataURI : PlaceholderURI;
}

// Called when playback stops.
function onPlaybackStop(reason) {
    //document.getElementById('Info').style.display = 'none';
    document.getElementById('StopReason').textContent = reason; // 'User' / 'EOF' / 'Starting another' / 'Shutting down'

    refreshProperties();
}

// Called when the user seeks to a specific time.
function onPlaybackSeek(time) {
    document.getElementById('Time').textContent = time; // in seconds
}

// Called when playback pauses or resumes.
function onPlaybackPause(paused) {
    document.getElementById('Paused').textContent = paused; // true / false

    refreshProperties();
}

// Called when the currently played file gets edited.
function onPlaybackEdited() {
    refresh();
}

// Called when dynamic info (VBR, bitrate, etc...) changes.
function onPlaybackDynamicInfo() {
    refresh();
}

// Called when the per-track dynamic info (stream, track, titles, etc...) change.
// Happens less often than `OnPlaybackDynamicInfo()`.
function onPlaybackDynamicTrackInfo() {
    refresh();
}

// Called, every second, for time display.
function onPlaybackTime(time) {
    document.getElementById('Time').textContent = time; // in seconds
    document.getElementById('TrackTime').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("[%playback_time%[/%length%]]");
}

// Called when the user changes the volume.
function onVolumeChange(newValue) {
    document.getElementById('Volume').textContent = newValue; // in dBFS
}

// Refreshes the content of all elements.
function refresh() {
    document.getElementById('Album').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("[%album%[: %subtitle%]]");
    document.getElementById('AlbumArtist').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("[%album artist%]");
    document.getElementById('AlbumDate').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("[%album recorded%]['/'%album released%]");
    document.getElementById('AlbumPublisher').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("[%publisher%[' ('%album country%')']]");
    document.getElementById('AlbumGenre').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("[%album genre%]");

    document.getElementById('TrackTitle').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("%title%[' ['%remix%']']");
    document.getElementById('TrackArtist').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("[%artist%]");
    document.getElementById('TrackCountry').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("[' ('%country%')']");
    document.getElementById('TrackFeaturing').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("['ft. '%featuring%]");
    document.getElementById('TrackDate').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("[%date%]");
    document.getElementById('TrackNumber').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("[%tracknumber%[/%totaltracks%]]");
    document.getElementById('TrackGenre').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("%genre%[/%subgenre%]");
    document.getElementById('TrackLanguage').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("[%language%]");

    document.getElementById('TrackTime').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("[%playback_time%[/%length%]]");
    document.getElementById('TrackCodec').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("%codec_long%[, $info(codec_profile)], $caps($info(encoding))");
    document.getElementById('TrackInfo').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("%samplerate%Hz, %bitrate% kbps[, $info(bitspersample) bit], $caps(%channels%)[, $caps($info(channel_mode))]");

    document.getElementById('TrackComposer').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("['Composer: '%composer%]");
    document.getElementById('TrackLyricist').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("['Lyricist: '%lyricist%]");
    document.getElementById('TrackComposed').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("['Composed in: ' %composed%]");
    document.getElementById('TrackConductor').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("['Conductor: '%conductor%]");
    document.getElementById('TrackOrchestra').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("['Orchestra: '%orchestra%]");
    document.getElementById('TrackArranger').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("['Arranger: ' %arranger%]");

    document.getElementById('OriginalAlbum').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("['Original Album: '%original album%]");

    document.getElementById('Medium').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("['Medium: '%medium%]");
    document.getElementById('Comment').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("['Comments: '%comment%]");
    document.getElementById('MIDI').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.getFormattedText("['MIDI: '$info(midi_player)][, $info(midi_active_voices) voices '(peak ' $info(midi_peak_voices)')'][, extra percussion channel $info(midi_extra_percussion_channel)]");

    refreshProperties();
}

// Refreshes the content of the property elements.
function refreshProperties() {
    document.getElementById('IsPlaying').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.isPlaying ? 'True' : 'False';
    document.getElementById('IsPaused').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.isPaused ? 'True' : 'False';
    document.getElementById('StopAfterCurrent').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.stopAfterCurrent ? 'True' : 'False';
    document.getElementById('Length').textContent = (Math.round(chrome.webview.hostObjects.sync.foo_uie_webview.length * 100) / 100).toFixed(2) + 's';
    document.getElementById('CanSeek').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.canSeek ? 'True' : 'False';
    document.getElementById('Mute').textContent = chrome.webview.hostObjects.sync.foo_uie_webview.isMuted ? '\u{1F508}' : '\u{1F507}';
}

// Called when the shared buffer does not exist yet or when the channel configuration changes.
function onSharedBufferReceived(e) {
    if (SharedBuffer) {
        window.chrome.webview.releaseBuffer(SharedBuffer);
        SharedBuffer = null;
        Samples = null;
    }

    if (!e.additionalData) {
        chrome.webview.hostObjects.sync.foo_uie_webview.print('foo_uie_webview JavaScript received shared buffer without additional data.');
        return;
    }

    SharedBuffer = e.getBuffer(); // as an ArrayBuffer
    Samples = new Float64Array(SharedBuffer);

    document.getElementById('Timestamp').textContent = Date.now();
    document.getElementById('SampleCount').textContent = e.additionalData.SampleCount;
    document.getElementById('SampleRate').textContent = e.additionalData.SampleRate;
    document.getElementById('ChannelCount').textContent = e.additionalData.ChannelCount;
    document.getElementById('ChannelConfig').textContent = getChannelConfigurationText(e.additionalData.ChannelConfig);
}

// Called when the visualisation timer ticks.
function onTimer(sampleCount, sampleRate, channelCount, channelConfig, windowOffset) {
    document.getElementById('Position').textContent = (Math.round(chrome.webview.hostObjects.sync.foo_uie_webview.position * 100) / 100).toFixed(2) + 's';

    let L = 0, R = 0;

    if (Samples && Samples.length >= 2) {
        for (i = 0; i < sampleCount; i += channelCount) {
            if ((channelConfig & 3) == 3) {
                // Front Left + Front Right
                L = Math.max(L, Samples[i]);
                R = Math.max(R, Samples[i + 1]);
            } else if ((channelConfig & 4) == 4) {
                // Front Center (Mono)
                L = R = Math.max(L, Samples[i]);
            }
        }
    } else {
        document.getElementById('Timer').textContent = 'N/A';
    }

    const normalizeValue = (value) => {
        const dB = 20 * Math.log10(value);

        return Math.min(Math.max((dB + 60) / 60, 0.0), 1.0);
    };

    L = normalizeValue(L);
    R = normalizeValue(R);

    document.getElementById('Timer').textContent =  Date.now() + ', ' + sampleCount + ' samples, ' + sampleRate + ' Hz, ' + channelCount + ' channels (0x' + ('00000000' + channelConfig.toString(16)).toUpperCase().slice(-8) + '), Left: ' + L.toFixed(2) + '%, Right: ' + R.toFixed(2) + '%, ' + windowOffset;
}

// Converts the channel configuration mask to text.
function getChannelConfigurationText(channelConfig) {
    const ChannelNames = [
        'FL', 'FR', 'FC',
        'LFE',
        'BL', 'BR',
        'FCL', 'FCR',
        'BC', 'SL', 'SR', 'TC',
        'TFL', 'TFC', 'TFR', 'TBL', 'TBC', 'TBR'
    ];

    return ChannelNames
        .filter(() => {
            const bit = channelConfig & 1;
            channelConfig >>= 1;
            return bit;
        })
        .join(' / ');
}
