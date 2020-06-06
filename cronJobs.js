const CronJob = require('cron').CronJob;
const fs = require('fs');
const path = require('path');

const { updateItemPermissions, saveFile } = require('./vendors/storage');

const { queues, TRANSCRIPTIONSCRIPTS_DIRECTORY } = require('./constants');
const { TRANSCRIBE_FINISH_QUEUE } = queues;
console.log('finis queue', TRANSCRIBE_FINISH_QUEUE)
const RABBITMQ_SERVER = process.env.RABBITMQ_SERVER;

// Services
const rabbitmqService = require('./vendors/rabbitmq');
const videoHandler = require('./dbHandlers/video');
const transcribeService = require('./vendors/transcribe');


let channel;
rabbitmqService.createChannel(RABBITMQ_SERVER, (err, ch) => {
    if (err) throw err;
    channel = ch;
    channel.assertQueue(TRANSCRIBE_FINISH_QUEUE, { durable: true });
    console.log('Cron job connected to rabbitmq');
})

const breakTranscribedIntoSlidesJob = new CronJob({
    cronTime: '* * * * *',
    onTick: function () {
        console.log('tick')
        if (!channel) return;
        videoHandler.find({ status: 'transcriping', jobName: { $exists: true } })
            .then((videos) => {
                if (!videos || videos.length === 0) return;
                videos.forEach((video) => {
                    if (video.vendor === 'aws' || !video.vendor) {
                        return transcribeService.getTranscriptionStatus(video.jobName)
                            .then(({ status, data }) => {
                                if (status && status.toLowerCase() === 'completed') {
                                    console.log(data);
                                    const transcriptionUrl = data.TranscriptionJob.Transcript.TranscriptFileUri;
                                    const parts = transcriptionUrl.split('/');
                                    const fileName = parts.pop();
                                    const directoryName = parts.pop()
                                    updateItemPermissions(directoryName, fileName, 'public-read')
                                        .then(() => {
                                            return videoHandler.updateById(video._id, { status: 'cutting', transcriptionUrl: data.TranscriptionJob.Transcript.TranscriptFileUri })
                                        })
                                        .then(res => {
                                            const msg = {
                                                videoId: video.videoId,
                                                langCode: video.langCode,
                                                withSubtitle: video.withSubtitle,
                                                videoUrl: video.videoUrl,
                                                numberOfSpeakers: video.numberOfSpeakers,
                                                transcriptionUrl,
                                                subtitlesUrl: video.subtitle,
                                                subtitleType: video.subtitleType,
                                                vendor: video.vendor,
                                            };
                                            channel.sendToQueue(TRANSCRIBE_FINISH_QUEUE, new Buffer(JSON.stringify(msg)), { persistent: true });
                                            console.log('cutting ', res);
                                        })
                                        .catch(err => {
                                            console.log(err)
                                        })
                                }
                            })
                            .catch(err => {
                                console.log('error getting transcription status', video, err);
                            })
                    } else if (video.vendor === 'gcp') {
                        return transcribeService.getGoogleTranscriptionStatus(video.jobName)
                            .then(({ status, data }) => {
                                if (status && status.toLowerCase() === 'completed') {
                                    const transcriptionText = data.result.results
                                        .map(result => result.alternatives[0].transcript)
                                        .join('\n');
                                    const transcriptionScriptPath = path.join(__dirname, 'tmp', `transcription_file_${Date.now()}.txt`)
                                    let transcriptionScriptUrl = '';
                                    fs.writeFile(transcriptionScriptPath, transcriptionText, (err) => {
                                        if (err) throw err;

                                        saveFile(TRANSCRIPTIONSCRIPTS_DIRECTORY, transcriptionScriptPath.split('/').pop(), fs.createReadStream(transcriptionScriptPath))
                                            .then(res => {
                                                transcriptionScriptUrl = res.url;
                                                fs.unlink(transcriptionScriptPath, () => { })
                                                return videoHandler.updateById(video._id, { status: 'cutting', transcriptionUrl: transcriptionScriptUrl })
                                            })
                                            .then(res => {
                                                const msg = {
                                                    videoId: video.videoId,
                                                    langCode: video.langCode,
                                                    withSubtitle: video.withSubtitle,
                                                    videoUrl: video.videoUrl,
                                                    numberOfSpeakers: video.numberOfSpeakers,
                                                    transcriptionScriptUrl,
                                                    transcriptionScriptContent: transcriptionText,
                                                    subtitlesUrl: video.subtitle,
                                                    subtitleType: video.subtitleType,
                                                    vendor: video.vendor,
                                                };
                                                channel.sendToQueue(TRANSCRIBE_FINISH_QUEUE, new Buffer(JSON.stringify(msg)), { persistent: true });
                                                console.log('cutddting ', res);
                                            })
                                            .catch(err => {
                                                console.log(err)
                                            })
                                    })
                                }
                            })
                            .catch(err => {
                                console.log(err);
                            })
                    }

                })
            })
            .catch(err => {
                console.log('error finding videos', err);
            })
    }
})

breakTranscribedIntoSlidesJob.start();