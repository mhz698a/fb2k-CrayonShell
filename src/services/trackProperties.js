export const TRACK_PROPERTY_FORMATS = {
    title: "$if2(%title%,%filename%)",
    artist: "%artist%",
    album: "%album%",
    albumArtist: "%album artist%",
    date: "%date%",
    genre: "%genre%",
    trackNumber: "%tracknumber%",
    discNumber: "%discnumber%",
    composer: "%composer%",
    label: "%label%",
    codec: "$codec()",
    bitrate: "%bitrate%",
    sampleRate: "%samplerate%",
    channels: "%channels%",
    bitDepth: "%__bitspersample%",
    extension: "$ext(%path%)",
    subsong: "%subsong%"
};

export const TRACK_PROPERTY_GROUPS = [
    {
        id: 'tags',
        title: 'Etiquetas',
        fields: [
            ['Título', 'title'],
            ['Artista', 'artist'],
            ['Álbum', 'album'],
            ['Artista del álbum', 'albumArtist'],
            ['Fecha', 'date'],
            ['Género', 'genre'],
            ['Número de pista', 'trackNumber'],
            ['Número de disco', 'discNumber'],
            ['Compositor', 'composer'],
            ['Sello', 'label']
        ]
    },
    {
        id: 'audio',
        title: 'Audio',
        fields: [
            ['Códec', 'codec'],
            ['Bitrate', 'bitrate'],
            ['Frecuencia de muestreo', 'sampleRate'],
            ['Canales', 'channels'],
            ['Bits por muestra', 'bitDepth'],
            ['Subsong', 'subsong']
        ]
    }
];
