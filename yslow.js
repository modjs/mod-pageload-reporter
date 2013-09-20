var fs = require('fs');

var yslowSource;
// yslow source ready
function initReadYslowSource(dirname){
	var sources = [];
	var basePath = dirname + "/yslow/";
	
	"yslow.js \
	version.js \
	componentSet.js \
	component.js \
	component-ph.js \
	controller.js \
	util.js \
	doc.js \
	rules.js \
	rulesets/sample.js \
	resultset.js \
	view.js \
	context.js \
	renderers.js \
	peeler.js \
	peeler-bm-ch-ph.js"
	.split(" ")
	.forEach(function(file){
		var path = basePath + file.trim();
		var contents = fs.read(path)
		sources.push(contents);
	});

	return yslowSource = sources.join("\n");
}


exports.run = function (options, done){
	
	if(!yslowSource) {
		initReadYslowSource(options.dirname);
	}
	
	var yslowArgs = {
		info: 'all',
		format: 'json',
		ruleset: 'ydefault',
		beacon: false,
		ua: false,
		viewport: false,
		headers: false,
		console: 0,
		threshold: 80,
		// set yslow unary args
		dict: false,
		verbose: false
	};
	
	var url = options.url;
	
    var page = require('webpage').create();
    page.resources = {};

    // allow x-domain requests, used to retrieve components content
    page.settings.webSecurityEnabled = false;

    // request
    page.onResourceRequested = function (req) {
        page.resources[req.url] = {
            request: req
        };
    };

    // response
    page.onResourceReceived = function (res) {
        var info,
            resp = page.resources[res.url].response;

        if (!resp) {
            page.resources[res.url].response = res;
        } else {
            for (info in res) {
                if (res.hasOwnProperty(info)) {
                    resp[info] = res[info];
                }
            }
        }
    };

    // enable console output, useful for debugging
    yslowArgs.console = parseInt(yslowArgs.console, 10) || 0;
    if (yslowArgs.console) {
        if (yslowArgs.console === 1) {
            page.onConsoleMessage = function (msg) {
                console.log(msg);
            };
            page.onError = function (msg) {
                console.error(msg);
            };
        } else {
            page.onConsoleMessage = function (msg, line, source) {
                console.log(JSON.stringify({
                    message: msg,
                    lineNumber: line,
                    source: source
                }, null, 4));
            };
            page.onError = function (msg, trace) {
                console.error(JSON.stringify({
                    message: msg,
                    stacktrace: trace
                }));
            };
        }
    } else {
        page.onError = function () {
            // catch uncaught error from the page
        };
    }

    // set user agent string
    if (yslowArgs.ua) {
        page.settings.userAgent = yslowArgs.ua;
    }

    // set page viewport
    if (yslowArgs.viewport) {
        var viewport = yslowArgs.viewport.toLowerCase();
        page.viewportSize = {
            width: parseInt(viewport.slice(0, viewport.indexOf('x')), 10) ||
                page.viewportSize.width,
            height: parseInt(viewport.slice(viewport.indexOf('x') + 1), 10) ||
                page.viewportSize.height
        };
    }

    // set custom headers
    if (yslowArgs.headers) {
        try {
            page.customHeaders = JSON.parse(yslowArgs.headers);
        } catch (err) {
            console.log('Invalid custom headers: ' + err);
        }
    }

    // open page
    page.startTime = new Date();
    page.open(url, function (status) {
        var yslow, ysphantomjs, controller, evalFunc, loadTime, url, resp,
            startTime = page.startTime,
            resources = page.resources;

        if (status !== 'success') {
            console.log('FAIL to load ' + url);
        } else {
            // page load time
            loadTime = new Date() - startTime;

            // set resources response time
            for (url in resources) {
                if (resources.hasOwnProperty(url)) {
                    resp = resources[url].response;
                    if (resp) {
                        resp.time = new Date(resp.time) - startTime;
                    }
                }
            }

            // yslow wrapper to be evaluated by page
            // yslow = function () {
                //YSLOW HERE
            // };

            // serialize YSlow phantomjs object
            // resources, yslow args and page load time
            ysphantomjs = 'YSLOW.phantomjs = {' +
                'resources: ' + JSON.stringify(resources) + ',' +
                'args: ' + JSON.stringify(yslowArgs) + ',' +
                'loadTime: ' + JSON.stringify(loadTime) + '};';

            // YSlow phantomjs controller
            controller = function () {
                YSLOW.phantomjs.run = function () {
                    try {
                        var results, xhr, output, threshold,
                            doc = document,
                            ys = YSLOW,
                            yscontext = new ys.context(doc),
                            yspeeler = ys.peeler,
                            comps = yspeeler.peel(doc),
                            baseHref = yspeeler.getBaseHref(doc),
                            cset = new ys.ComponentSet(doc),
                            ysphantomjs = ys.phantomjs,
                            resources = ysphantomjs.resources,
                            args = ysphantomjs.args,
                            ysutil = ys.util,

                            // format out with appropriate content type
                            formatOutput = function (content, format) {
                                format = format || (args.format || '').toLowerCase();
                                var harness = {
                                        'tap': {
                                            func: ysutil.formatAsTAP,
                                            contentType: 'text/plain'
                                        },
                                        'junit': {
                                            func: ysutil.formatAsJUnit,
                                            contentType: 'text/xml'
                                        }
                                    };

                                switch (format) {
                                case 'xml':
                                    return {
                                        content: ysutil.objToXML(content),
                                        contentType: 'text/xml'
                                    };
                                case 'plain':
                                    return {
                                        content: ysutil.prettyPrintResults(
                                            content
                                        ),
                                        contentType: 'text/plain'
                                    };
                                // test formats
                                case 'tap':
                                case 'junit':
                                    try {
                                        threshold = JSON.parse(args.threshold);
                                    } catch (err) {
                                        threshold = args.threshold;
                                    }
                                    return {
                                        content: harness[format].func(
                                            ysutil.testResults(
                                                content,
                                                threshold
                                            )
                                        ),
                                        contentType: harness[format].contentType
                                    };
                                default:
                                    return {
                                        content: JSON.stringify(content),
                                        contentType: 'application/json'
                                    };
                                }
                            },

                            // format raw headers into object
                            formatHeaders = function (headers) {
                                var reHeader = /^([^:]+):\s*([\s\S]+)$/,
                                    reLineBreak = /[\n\r]/g,
                                    header = {};

                                headers.split('\n').forEach(function (h) {
                                    var m = reHeader.exec(
                                            h.replace(reLineBreak, '')
                                        );

                                    if (m) {
                                        header[m[1]] = m[2];
                                    }
                                });

                                return header;
                            };

                        comps.forEach(function (comp) {
                            var res = resources[comp.href] || {};

                            cset.addComponent(
                                comp.href,
                                comp.type,
                                comp.base || baseHref,
                                {
                                    obj: comp.obj,
                                    request: res.request,
                                    response: res.response
                                }
                            );
                        });

                        // refinement
                        cset.inline = ysutil.getInlineTags(doc);
                        cset.domElementsCount = ysutil.countDOMElements(doc);
                        cset.cookies = cset.doc_comp.cookie;
                        cset.components = ysutil.setInjected(doc,
                            cset.components, cset.doc_comp.body);

                        // run analysis
                        yscontext.component_set = cset;
                        ys.controller.lint(doc, yscontext, args.ruleset);
                        yscontext.result_set.url = baseHref;
                        yscontext.PAGE.t_done = ysphantomjs.loadTime;
                        yscontext.collectStats();
                        results = ysutil.getResults(yscontext, args.info);

                        // prepare output results
                        if (args.dict && args.format !== 'plain') {
                            results.dictionary = ysutil.getDict(args.info,
                                args.ruleset);
                        }

                        // output = {};
                        // ['json', 'tap'].forEach(function(format){
                        //     output[format]  = formatOutput(results, format);
                        // })

                        output = formatOutput(results);

                        // return JSON.stringify(output);
                        return output.content;

                    } catch (err) {
                        return err;
                    }
                };

                return YSLOW.phantomjs.run();
            };

            // serialize then combine:
            // YSlow + page resources + args + loadtime + controller
            // yslow = yslow.toString();
			// yslow = yslow.slice(13, yslow.length - 1);
			yslow = yslowSource;
            // minification removes last ';'
            if (yslow.slice(yslow.length - 1) !== ';') {
                yslow += ';';
            }
            controller = controller.toString();
            controller = controller.slice(13, controller.length - 1);
            evalFunc = new Function(yslow + ysphantomjs + controller);

			// evaluate script and log results
            var res = page.evaluate(evalFunc);
			if(typeof res === 'string'){
				res = JSON.parse(res)
			}
			var yslowJSONReport = './yslow/'+ encodeURIComponent(cliConfig.url) +'.json';
			if(fs.exists(yslowJSONReport)){
				fs.remove(yslowJSONReport);
			}
			var f = fs.open(yslowJSONReport, "w");
			f.writeLine(JSON.stringify(res, undefined, 4));
			f.close();
        }

        // finish yslow
        done(res);
    });
	
};



