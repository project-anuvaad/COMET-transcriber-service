const fs = require('fs');
const uuid = require('uuid').v4;
const path = require('path');
const videoHandler = require('../dbHandlers/video');
const storageService = require('../vendors/storage');
const transcribeService = require('../vendors/transcribe');
const { supportedTranscribeLangs } = require('../vendors/transcribe/constants');

const { queues } = require('../constants');
const { TRANSCRIBE_FINISH_QUEUE, TRANSCRIBE_VIDEO_STARTED_QUEUE, TRANSCRIBE_VIDEO_FAILED_QUEUE } = queues;

const utils = require('../utils');

const AUDIO_DIRECTORY_NAME = 'audio';
const AUDIO_EXTENSION = 'mp3';

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
    const audioPath = `${path.join(__dirname, '../tmp')}/${uuid()}.${AUDIO_EXTENSION}`;
    return utils.downloadFile(videoUrl, videoPath)
        .then(videoPath => {
            tmpFiles.push(videoPath);
            console.log('extracting')
            return utils.extractAudioFromVideo(videoPath, audioPath);
        })
        .then(() => {
            tmpFiles.push(audioPath);
            return storageService.saveFile(AUDIO_DIRECTORY_NAME, `${uuid()}.${AUDIO_EXTENSION}`, fs.createReadStream(audioPath))
        })
        .then((res) => {
            console.log('extracted audio');
            audioUrl = res.url;
            // if the langCode is supported by aws, save file and start transcription
            const lang = supportedTranscribeLangs.find(l => l.code.toLowerCase().indexOf(langCode.toLowerCase()) !== -1)
            if (!lang) {
                throw new Error('Unsupported language');
            }
            if (lang.vendor === 'aws') {
                return transcribeService.transcribe(res.url, langCode, numberOfSpeakers)
                    .then((res) => {
                        channel.sendToQueue(TRANSCRIBE_VIDEO_STARTED_QUEUE, new Buffer(JSON.stringify({ videoId, jobName: res.jobName, audioUrl })))
                        // console.log('transcribe started', { videoId, jobName: res.jobName, audioUrl });

                        return videoHandler.create({
                            videoId,
                            jobName: res.jobName,
                            status: 'transcriping',
                            vendor: lang.vendor,
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
            } else if (lang.vendor === 'gcp') {
                return utils.getAudioSampleRate(audioPath)
                    .then(sampleRate => {
                        return transcribeService.transcribeGoogle({ langCode: lang.code, fileBuffer: fs.readFileSync(audioPath), encoding: AUDIO_EXTENSION, sampleRate })
                    })
                    .then((jobName) => {
                        channel.sendToQueue(TRANSCRIBE_VIDEO_STARTED_QUEUE, new Buffer(JSON.stringify({ videoId, jobName, audioUrl })))
                        console.log('transcribe started', { videoId, jobName, audioUrl });

                        return videoHandler.create({
                            videoId,
                            jobName,
                            status: 'transcriping',
                            vendor: lang.vendor,
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
            } else {
                throw new Error('Unsupported vendor');
            }
        })
        .catch(err => {
            utils.cleanupFiles(tmpFiles);
            channel.ack(msg)
            console.log(err);
            return channel.sendToQueue(TRANSCRIBE_VIDEO_FAILED_QUEUE, new Buffer(JSON.stringify({ videoId })))

        })
}

module.exports = onTranscribeVideo;