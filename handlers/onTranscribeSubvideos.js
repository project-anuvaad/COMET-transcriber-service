const fs = require('fs');
const uuid = require('uuid').v4;
const path = require('path');
const async = require('async');
const videoHandler = require('../dbHandlers/video');
const storageService = require('../vendors/storage');
const transcribeService = require('../vendors/transcribe');

const { queues } = require('../constants');
const { TRANSCRIBE_FINISH_QUEUE, TRANSCRIBE_VIDEO_STARTED_QUEUE, TRANSCRIBE_VIDEO_FAILED_QUEUE } = queues;

const utils = require('../utils');

const VIDEOS_DIRECTORY_NAME = 'cut_videos';

const onTranscribeVideo = channel => (msg) => {
    const { videoId, slides, videoUrl, langCode, numberOfSpeakers } = JSON.parse(msg.content.toString());
    const tmpFiles = [];
    // Get the video
    // Cut the video into slides 
    // upload the video to s3
    // emit event to transcripe the audio
        let videoPath = path.join(__dirname, '../', 'tmp', `${uuid()}.${utils.getFileExtension(videoUrl || '')}`);
    tmpFiles.push(videoPath);
    console.log('downloading video');
    return utils.downloadFile(videoUrl, videoPath)
    .then(() => {
        console.log('cutting video into slides');
        return utils.cutSlidesIntoVideos(slides, videoPath);  
    })
    .then(slides => {
        const uploadVideoFuncArray = [];
        slides.forEach(slide => {
            tmpFiles.push(slide.video)
            uploadVideoFuncArray.push((cb) => {
                storageService.saveFile(VIDEOS_DIRECTORY_NAME, slide.video.split('/').pop(), fs.createReadStream(slide.video))
                .then(uploadRes => {
                    slide.videoUrl = uploadRes.url;
                    slide.videoKey = uploadRes.Key;
                    return cb();
                })  
                .catch(err => {
                    console.log(err);
                    return cb();
                })              
            })
        });
        console.log('uploading subvideos')
        return new Promise((resolve) => {
            async.parallelLimit(uploadVideoFuncArray, 5, () => {
                resolve(slides);
            })
        })
    })
    .then(slides => {
        console.log('sending subvideos to transcribe');
        // Send to be transcribed individually
        slides.filter(s => s.videoUrl).forEach(slide => {
            channel.sendToQueue(queues.TRANSCRIBE_VIDEO_QUEUE, Buffer.from(JSON.stringify({ videoId: `${videoId}-${slide.slidePosition}-${slide.subslidePosition}`, videoUrl: slide.videoUrl, langCode, numberOfSpeakers: 1, })))
        })
        channel.ack(msg);
    })
    .catch(err => {
        channel.ack(msg);
        console.log(err);
    })
}

module.exports = onTranscribeVideo;