module.exports = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_ACCESS_KEY_SECRET,
    transcribeBucketName: process.env.AWS_TRANSCRIBER_TRANSCRIPTIONS_BUCKET_NAME,
    defaultRegion:  process.env.AWS_DEFAULT_REGION
}