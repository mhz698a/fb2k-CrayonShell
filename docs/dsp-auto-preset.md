# DSP Auto Preset Manager

## Configuration

The feature settings are owned by the provider \`dsp.auto-preset\` and are included automatically in the global CrayonShell settings backup and restore.

The versioned local settings contain:

- \`defaultPreset\`: preset used when no song or folder rule matches and after a user stop or end of track.
- \`folderRules\`: folder path to preset mappings. The most deeply nested matching folder wins.
- \`trackRules\`: exact file path exceptions. These take priority over every folder rule.

Paths are normalized for Windows separator and case differences. Duplicate folder paths and duplicate track paths are rejected.

## Playback integration

When a user activates a playlist row through CrayonShell, \`usePlaylist.playItem()\` resolves and applies the destination preset before calling \`playlist.playTrack\`. The controller reads the active chain first and skips the SDK write when the requested preset is already active.

The controller listens for:

- \`playback:trackChanged\`: synchronize changes initiated outside the CrayonShell row action.
- \`playback:stopped\`: restore the default after user stop or end of track. The \`starting_another\` reason is explicitly ignored.
- \`audio:dspPresetChanged\`: keep the observable active-preset state synchronized with manual changes.

A single-flight latest-request queue prevents rapid track changes from applying an obsolete queued preset after a newer destination has been selected. The observable state is available through \`getDspAutoPresetState()\` and \`subscribeDspAutoPresetState()\`.

## Host limitations

The current \`playback:starting\` event contains the command but not the destination track path. Consequently, CrayonShell can prepare a destination before a row play it initiates, but cannot guarantee anticipation for every next/previous/random transition initiated externally or by foobar2000 autoplay. The controller synchronizes those transitions from \`playback:trackChanged\`.

The DSP API confirms the selected preset through \`dsp.getChain()\`. The host does not expose a separate VST-initialization-complete event, so the confirmed state means the preset is selected in foobar2000; it is not a claim that every third-party VST has completed its internal initialization.

A DSP error does not prevent the user from starting playback. The controller exposes the failure state and a subsequent track-change event can retry the rule.
