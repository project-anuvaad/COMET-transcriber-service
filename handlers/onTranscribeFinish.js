const videoHandler = require('../dbHandlers/video');
const path = require('path');
const fs = require('fs');
const uuid = require('uuid').v4;
const queues = require('../constants').queues;
const transcribeParser = require('../transcribeParser');

const utils = require('../utils');


const onTranscribeFinish = channel => (msg) => {
    const { videoId, langCode, withSubtitle, videoUrl, numberOfSpeakers, transcriptionUrl, subtitlesUrl, vendor, transcriptionScriptUrl,transcriptionScriptContent } = JSON.parse(msg.content.toString());
    console.log(JSON.parse(msg.content.toString()))
    // Find video
    // Download transcription for processing
    // Break video into slides
    // Create a new article with the slides
    // Change video status to proofreading
    // cleanup
    const tmpFiles = [];
    let transcriptionPath;
    let subtitlePath;
    let videoPath;
    let formattedSlides;
    let videoDuration;
    videoPath = `${path.join(__dirname, '../tmp')}/${uuid()}.${utils.getFileExtension(videoUrl)}`;

    // const downloadFilesPromise = new Promise((resolve, reject) => {
    //     if (withSubtitle && subtitlesUrl) {
    //         subtitlePath = `${path.join(__dirname, '../tmp')}/${uuid()}.${utils.getFileExtension(subtitlesUrl)}`;
    //         return utils.downloadFile(subtitlesUrl, subtitlePath)
    //     }

    // })
    console.log('download vidddeo')
    return utils.downloadFile(videoUrl, videoPath)
        .then(vpath => {
            videoPath = vpath;
            tmpFiles.push(videoPath);
            return utils.getRemoteFileDuration(videoPath);
        })
        .then(duration => {
            videoDuration = duration;
            if (vendor === 'aws') {
                // download transcription file
                // parse transcription
                // format slides
                // send response
                transcriptionPath = `${path.join(__dirname, '../tmp')}/${uuid()}.${utils.getFileExtension(transcriptionUrl)}`;
                console.log('downloading trans');
                return utils.downloadFile(transcriptionUrl, transcriptionPath)
                    .then(() => {
                        tmpFiles.push(transcriptionPath);
                        let parsedTranscription;
                        if (withSubtitle) {
                            parsedTranscription = transcribeParser.parseSubtitle(fs.readFileSync(subtitlePath, { encoding: 'utf8' }), 'srt');
                        } else {
                            parsedTranscription = transcribeParser.parseTranscription(require(transcriptionPath), numberOfSpeakers);
                        }
                        return utils.breakVideoIntoSlides(videoPath, parsedTranscription, langCode.split('-')[0]);
                    })
                    .then(slides => {
                        // Format slides to match article schema
                        formattedSlides = utils.formatSlidesToSlideSpeakerSchema(slides);
                        return Promise.resolve(formattedSlides);
                    })
                    .then(() => {
                        console.log('done');
                        channel.sendToQueue(queues.TRANSCRIBE_VIDEO_FINISHED_QUEUE, new Buffer(JSON.stringify({ videoId, duration: videoDuration, slides: formattedSlides, speakersProfile: utils.getSpeakersFromSlides(formattedSlides), transcriptionUrl, transcription: require(transcriptionPath) })));
                        videoHandler.update({ videoId }, { status: 'done' })
                        utils.cleanupFiles(tmpFiles);
                        channel.ack(msg);
                    })
                    .catch(err => {
                        console.log(err);
                        utils.cleanupFiles(tmpFiles);
                        channel.ack(msg);
                        channel.sendToQueue(queues.TRANSCRIBE_VIDEO_FAILED_QUEUE, new Buffer(JSON.stringify({ videoId })));
                    })
            }
            if (vendor === 'gcp') {
                // Forward transcriptionScriptUrl to channel
                console.log('gcp done');
                channel.sendToQueue(queues.TRANSCRIBE_VIDEO_FINISHED_QUEUE, new Buffer(JSON.stringify({ videoId, duration: videoDuration, transcriptionScriptUrl, transcriptionScriptContent })));
                videoHandler.update({ videoId }, { status: 'done' })
                utils.cleanupFiles(tmpFiles);
                return channel.ack(msg);
            }
            throw new Error('Unsupported vendor');
        })
        .catch(err => {
            console.log(err);
            utils.cleanupFiles(tmpFiles);
            channel.ack(msg);
            channel.sendToQueue(queues.TRANSCRIBE_VIDEO_FAILED_QUEUE, new Buffer(JSON.stringify({ videoId })));
        })
}

module.exports = onTranscribeFinish;