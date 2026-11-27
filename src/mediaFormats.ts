import { MP4, QTFF, MATROSKA, WEBM, WAVE, OGG, FLAC, MP3, ADTS, MPEG_TS } from 'mediabunny'
// Single local files only. Network playlists cannot enter the demuxer.
export const localFormats = [MP4, QTFF, MATROSKA, WEBM, WAVE, OGG, FLAC, MP3, ADTS, MPEG_TS]
