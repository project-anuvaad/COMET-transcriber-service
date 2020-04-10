const videoHandler = require('../dbHandlers/video');
const path = require('path');
const fs = require('fs');
const uuid = require('uuid').v4;
const queues = require('../constants').queues;
const transcribeParser = require('../transcribeParser');

const utils = require('../utils');


const onTranscribeFinish = channel => (msg) => {
    const { videoId, langCode, withSubtitle, videoUrl, numberOfSpeakers, transcriptionUrl, subtitlesUrl  } = JSON.parse(msg.content.toString());
    // Find video
    // Download transcription for processing
    // Break video into slides
    // Create a new article with the slides
    // Change video status to proofreading
    // cleanup
    const tmpFiles = [];
    let video;
    let transcriptionPath;
    let subtitlePath;
    let videoPath;
    let formattedSlides;
    videoPath = `${path.join(__dirname, '../tmp')}/${uuid()}.${utils.getFileExtension(videoUrl)}`;

    console.log('downloading trans');
    if (withSubtitle && subtitlesUrl) {
        subtitlePath = `${path.join(__dirname, '../tmp')}/${uuid()}.${utils.getFileExtension(subtitlesUrl)}`;

        return utils.downloadFile(subtitlesUrl, subtitlePath)
    }
    transcriptionPath = `${path.join(__dirname, '../tmp')}/${uuid()}.${utils.getFileExtension(transcriptionUrl)}`;
    utils.downloadFile(transcriptionUrl, transcriptionPath)
    .then((transcriptionPath) => {
        tmpFiles.push(transcriptionPath);
        console.log('download video')
        return utils.downloadFile(videoUrl, videoPath);
    })
    .then(videoPath => {
        tmpFiles.push(videoPath);
        let parsedTranscription;
        if (withSubtitle) {
            parsedTranscription = transcribeParser.parseSubtitle(fs.readFileSync(subtitlePath, { encoding: 'utf8' }), subtitleType || 'srt');
        } else { 
            parsedTranscription = transcribeParser.parseTranscription(require(transcriptionPath), numberOfSpeakers);
        }
        return utils.breakVideoIntoSlides(videoPath, parsedTranscription, langCode.split('-')[0]);
    })
    .then(slides => {
        // Format slides to match article schema
        formattedSlides = utils.formatSlidesToSlideSpeakerSchema(slides);
        return utils.getRemoteFileDuration(videoPath);
    })
    .then((duration) => {
        console.log('done');
        utils.cleanupFiles(tmpFiles);
        channel.sendToQueue(queues.VIDEO_PROOFREADING_READY, new Buffer(JSON.stringify({ videoId, duration, slides: formattedSlides })));
        videoHandler.update({ videoId }, { status: 'done' })
        channel.ack(msg);
    })
    .catch(err => {
        console.log(err);
        utils.cleanupFiles(tmpFiles);
        channel.ack(msg);
        channel.sendToQueue(queues.TRANSCRIBE_VIDEO_FAILED_QUEUE, new Buffer(JSON.stringify({ videoId })));
    })
}

module.exports = onTranscribeFinish;