const fs = require('fs');
const uuid = require('uuid').v4;
const path = require('path');
const videoHandler = require('../dbHandlers/video');
const storageService = require('../vendors/storage');
const transcribeService = require('../vendors/transcribe');

const { queues } = require('../constants');
const { TRANSCRIBE_FINISH_QUEUE, TRANSCRIBE_VIDEO_STARTED_QUEUE, TRANSCRIBE_VIDEO_FAILED_QUEUE } = queues;

const utils = require('../utils');

const AUDIO_DIRECTORY_NAME = 'audio';

const onTranscribeVideo = channel => (msg) => {
    const { videoId, withSubtitle, videoUrl, langCode, numberOfSpeakers, subtitlesUrl, subtitleType } = JSON.parse(msg.content.toString());
    const tmpFiles = [];
    // Get the video
    // Extract audio from it
    // upload the audio to s3 for transcription
    // start a transcription job
    // update video status to transcribing
    let audioUrl;
    if (withSubtitle) {
        channel.sendToQueue(TRANSCRIBE_FINISH_QUEUE, new Buffer(JSON.stringify({ videoId, withSubtitle, videoUrl, numberOfSpeakers, subtitlesUrl, subtitleType, langCode })), { persistent: true });
        channel.ack(msg);
        return false;
    }
    console.log('downloading')
    const videoPath = `${path.join(__dirname, '../tmp')}/${uuid()}.${utils.getFileExtension(videoUrl || '')}`;
    return utils.downloadFile(videoUrl, videoPath)
        .then(videoPath => {
            tmpFiles.push(videoPath);
            console.log('extracting')
            const audioPath = `${path.join(__dirname, '../tmp')}/${uuid()}.mp3`;
            return utils.extractAudioFromVideo(videoPath, audioPath);
        })
        .then((audioPath) => {
            console.log('extracted audio');
            tmpFiles.push(audioPath);
            return storageService.saveFile(AUDIO_DIRECTORY_NAME, `${uuid()}.mp3`, fs.createReadStream(audioPath));
        })
        .then((res) => {
            console.log('saved audio file');
            audioUrl = res.url;
            return transcribeService.transcribe(res.url, langCode, numberOfSpeakers)
        })
        .then((res) => {
            channel.sendToQueue(TRANSCRIBE_VIDEO_STARTED_QUEUE, new Buffer(JSON.stringify({ videoId, jobName: res.jobName, audioUrl })))
            console.log('transcribe started', { videoId, jobName: res.jobName, audioUrl });

            // videoId: video.videoId,
            // langCode: video.langCode,
            // withSubtitle: video.withSubtitle,
            // videoUrl: video.url,
            // numberOfSpeakers: video.numberOfSpeakers,
            // transcriptionUrl,
            // subtitlesUrl: video.subtitle,
            // subtitleType: video.subtitleType,
            return videoHandler.create({
                videoId,
                jobName: res.jobName,
                status: 'transcriping',
                audioUrl,
                langCode,
                videoUrl,
                numberOfSpeakers,
                withSubtitle,
                subtitlesUrl,
                subtitleType,
            });
        })
        .then((res) => {
            console.log('job started', res);
            channel.ack(msg);
            // Cleanup
            utils.cleanupFiles(tmpFiles);
        })
        .catch(err => {
            utils.cleanupFiles(tmpFiles);
            channel.ack(msg)
            console.log(err);
            return channel.sendToQueue(TRANSCRIBE_VIDEO_FAILED_QUEUE, new Buffer(JSON.stringify({ videoId })))

        })
}

module.exports = onTranscribeVideo;