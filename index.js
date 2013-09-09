exports.summary = 'Page Loading Reporter';

exports.usage = '<src> [options]';

exports.options = {
    "dest" : {
        alias : 'd'
        ,default : '<src>'
        ,describe : 'destination file'
    },

    "charset" : {
        alias : 'c'
        ,default : 'utf-8'
        ,describe : 'file encoding type'
    }
};

exports.run = function (options, done) {
    var src = options.src;
    var dest = options.dest;
    var phantomjs = exports.loadTask('mod-phantomjs');
	var path = require('path');
	
    phantomjs.run({
        script: path.resolve(__dirname, "./loadreport.js"),
        args: "http://www.baidu.com filmstrip"
    }, done);
};
