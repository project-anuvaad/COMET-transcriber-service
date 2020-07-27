const subtitle = require('subtitle');
function isItemInContent(start_time, end_time, item) {
    return item.start_time >= start_time && item.end_time <= end_time;
}

function parseTranscription(transcription, noOfSpeakers) {
    const { results } = transcription;
    const { speaker_labels, items } = results;
    const slidesStartEndTime = [];
    const slidesContent = [];
    
    if (noOfSpeakers > 1) {
        if (!speaker_labels || !speaker_labels.segments) return [];

        const { segments } = speaker_labels;
        segments.forEach((segment) => {
            const { start_time, end_time, speaker_label } = segment;
            slidesStartEndTime.push({ start_time: parseFloat(start_time), end_time: parseFloat(end_time), speaker_label });
        });
    } else {
        if (!items || items.length === 0 || !items.find((s) => s.start_time)) return [];

        slidesStartEndTime.push({
            start_time: parseFloat(items.find((s) => s.start_time).start_time),
            end_time: parseFloat(items.slice().reverse().find((s) => s.start_time).end_time),
            speaker_label: 'spk_1',
        })
    }
    slidesStartEndTime.forEach(({ start_time, end_time, speaker_label }) => {
        let content = [];
        let slideItems = [];
        items.forEach((item, index) => {

            if ( isItemInContent(start_time, end_time, item) ||
                // Add to the content if it's a punctuation and the prev item was in the content
                (item.type === 'punctuation' && index !== 0 && isItemInContent(start_time, end_time, items[index - 1]))                
            ) {
                if (item.type === 'punctuation') {
                    content.push(`${item.alternatives[0].content}`);
                } else {
                    content.push(` ${item.alternatives[0].content}`);
                }
                slideItems.push(item);
            }
        })
        slidesContent.push({ startTime: start_time, endTime: end_time, speakerLabel: speaker_label, content: content.join('').trim(), items: slideItems })
    })
    return slidesContent
}

function parseSubtitle(subtitleText) {
    /* eslint-disable no-control-regex */
    const parsedSubtitle =  subtitle.parse(subtitleText).map((item) => ({ ...item, speakerLabel: 'spk_1', content: `${item.text} `.replace(/[\r\n\x0B\x0C\u0085\u2028\u2029]+/g," "), startTime: item.start / 1000, endTime: item.end / 1000, items: [{start_time: item.start / 1000, end_time: item.end / 1000, type: 'pronunciation', alternatives: [{ content: `${item.text} `.replace(/[\r\n\x0B\x0C\u0085\u2028\u2029]+/g," ") }]}] }));
    return parsedSubtitle;
}

module.exports = {
    parseTranscription,
    parseSubtitle,
}