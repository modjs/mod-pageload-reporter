exports.summary = 'Page Loading Reporter';

exports.usage = '<url> [options]';

exports.options = {
    "url" : {
        describe : 'the URL of the destination site to load test'
    },
    "task": {
        describe: "the task to perform"
    },
    
    "config": {
        describe: "a local configuration file of further loadreport settings"
    }
};

exports.run = function (options, done) {
    var url = options.url;
    var task = options.task;
    var config = options.config;
	debugger;
    var phantomjs = exports.loadTask('mod-phantomjs');
    var path = require('path');
    
    phantomjs.run({
        script: path.join(__dirname, "loadreport.js"),
        args: [url, config || path.join(__dirname, "config.json"), __dirname, task || '']
    }, done);
};
