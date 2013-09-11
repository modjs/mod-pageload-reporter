var fs = require('fs');
var WebPage = require('webpage');
var netsniff = require('./netsniff');

phantom.onError = function(msg, trace) {
    var msgStack = ['PHANTOM ERROR: ' + msg];
    if (trace && trace.length) {
        msgStack.push('TRACE:');
        trace.forEach(function(t) {
            msgStack.push(' -> ' + (t.file || t.sourceURL) + ': ' + t.line + (t.function ? ' (in function ' + t.function + ')' : ''));
        });
    }
    console.error(msgStack.join('\n'));
    phantom.exit(1);
};

function processArgs(config, contract) {
    var a = 0;
    var ok = true;

    contract.forEach(function(argument) {
        if (a < phantom.args.length) {
            config[argument.name] = phantom.args[a];
        } else {
            if (argument.req) {
                console.log('"' + argument.name + '" argument is required. This ' + argument.desc + '.');
                ok = false;
            } else {
                config[argument.name] = argument.def;
            }
        }
        if (argument.oneof && argument.oneof.indexOf(config[argument.name])==-1) {
            console.log('"' + argument.name + '" argument must be one of: ' + argument.oneof.join(', '));
            ok = false;
        }
        a++;
    });
    return ok;
}

function mergeConfig(config, configFile) {
    if (!fs.exists(configFile)) {
        configFile = "config.json";
    }
    var result = JSON.parse(fs.read(configFile)),
        key;
    for (key in config) {
        result[key] = config[key];
    }
    return result;
}

function truncate(str, length) {
    length = length || 80;
    if (str.length <= length) {
        return str;
    }
    var half = length / 2;
    return str.substr(0, half-2) + '...' + str.substr(str.length-half+1);
}

function pad(str, length) {
    var padded = str.toString();
    if (padded.length > length) {
        return pad(padded, length * 2);
    }
    return repeat(' ', length - padded.length) + padded;
}

function repeat(chr, length) {
    for (var str = '', l = 0; l < length; l++) {
        str += chr;
    }
    return str;
}

function clone(obj) {
    var target = {};
    for (var i in obj) {
        if (obj.hasOwnProperty(i)) {
            target[i] = obj[i];
        }
    }
    return target;
}

function timerStart() {
    return (new Date()).getTime();
}

function timerEnd(start) {
    return ((new Date()).getTime() - start);
}

var loadreport = {

    performance: {
        resources: [],
        planTime : 0,
        lastTime: 0,
        timer : 0,
        evalConsole : {},
        evalConsoleErrors : [],
        onInitialized: function(page, config) {
            var pageeval = page.evaluate(function(startTime) {
                var now = new Date().getTime();
                //check the readystate within the page being loaded

                //Returns "loading" while the document is loading
                var _timer3=setInterval(function(){
                    if(/loading/.test(document.readyState)){
                        console.log('loading-' + (new Date().getTime() - startTime));
                        //don't clear the interval until we get last measurement
                    }
                }, 5);

                // "interactive" once it is finished parsing but still loading sub-resources
                var _timer1=setInterval(function(){
                    if(/interactive/.test(document.readyState)){
                        console.log('interactive-' + (new Date().getTime() - startTime));
                        clearInterval(_timer1); 
                        //clear loading interval
                        clearInterval(_timer3); 
                    }
                }, 5);

                //"complete" once it has loaded - same as load event below
                // var _timer2=setInterval(function(){
                //     if(/complete/.test(document.readyState)){
                //         console.log('complete-' + (new Date().getTime() - startTime));
                //         clearInterval(_timer2);
                //     }
                // }, 5);

                //The DOMContentLoaded event is fired when the document has been completely 
                //loaded and parsed, without waiting for stylesheets, images, and subframes 
                //to finish loading
                document.addEventListener("DOMContentLoaded", function() {
                    console.log('DOMContentLoaded-' + (new Date().getTime() - startTime));
                }, false);

                //detect a fully-loaded page
                window.addEventListener("load", function() {
                    console.log('onload-' + (new Date().getTime() - startTime));
                }, false);
                
                //check for JS errors
                window.onerror = function(message, url, linenumber) {
                    console.log("jserror-JavaScript error: " + message + " on line " + linenumber + " for " + url);
                };
            },this.performance.start);
        },
        onLoadStarted: function (page, config) {
            if (!this.performance.start) {
                this.performance.start = new Date().getTime();
            }
        },
        onResourceRequested: function (page, config, request) {
            var now = new Date().getTime();
            this.performance.resources[request.id] = {
                id: request.id,
                url: request.url,
                request: request,
                responses: {},
                duration: '',
                times: {
                    request: now
                }
            };
            if (!this.performance.start || now < this.performance.start) {
                this.performance.start = now;
            }

        },
        onResourceReceived: function (page, config, response) {
            var now = new Date().getTime(),
                resource = this.performance.resources[response.id];
            resource.responses[response.stage] = response;
            if (!resource.times[response.stage]) {
                resource.times[response.stage] = now;
                resource.duration = now - resource.times.request;
            }
            if (response.bodySize) {
                resource.size = response.bodySize;
                response.headers.forEach(function (header) {
                });
            } else if (!resource.size) {
                response.headers.forEach(function (header) {
                    if (header.name.toLowerCase()=='content-length' && header.value != 0) {
                        //console.log('backup-------' + header.name + ':' + header.value);
                        resource.size = parseInt(header.value);
                    }
                });
            }
        },
        onLoadFinished: function (page, config, status) {
            var start = this.performance.start,
                finish =  new Date().getTime(),
                resources = this.performance.resources,
                slowest, fastest, totalDuration = 0,
                largest, smallest, totalSize = 0,
                missingList = [],
                missingSize = false,
                elapsed = finish - start,
                now = new Date();

            resources.forEach(function (resource) {
                if (!resource.times.start) {
                    resource.times.start = resource.times.end;
                }
                if (!slowest || resource.duration > slowest.duration) {
                    slowest = resource;
                }
                if (!fastest || resource.duration < fastest.duration) {
                    fastest = resource;
                }
                //console.log(totalDuration);
                totalDuration += resource.duration;

                if (resource.size) {
                    if (!largest || resource.size > largest.size) {
                        largest = resource;
                    }
                    if (!smallest || resource.size < smallest.size) {
                        smallest = resource;
                    }
                    totalSize += resource.size;
                } else {
                    resource.size = 0;
                    missingSize = true;
                    missingList.push(resource.url);
                }
            });

            if (config.verbose) {
                console.log('');
                this.emitConfig(config, '');
            }

            var report = {};
            report.url = phantom.args[0];
            report.phantomCacheEnabled = phantom.args.indexOf('yes') >= 0 ? 'yes' : 'no';
            report.taskName = config.task;
            var drsi = parseInt(this.performance.evalConsole.interactive);
            var drsl = parseInt(this.performance.evalConsole.loading);
            var wo = parseInt(this.performance.evalConsole.onload);
            // var drsc = parseInt(this.performance.evalConsole.complete);

            report.domReadystateLoading = isNaN(drsl) == false ? drsl : 0;
            report.domReadystateInteractive = isNaN(drsi) == false ? drsi : 0;
            // report.domReadystateComplete = isNaN(drsc) == false ? drsc : 0;
            report.windowOnload = isNaN(wo) == false ? wo : 0;
            
            report.elapsedLoadTime = elapsed;
            report.numberOfResources = resources.length-1;
            report.totalResourcesTime = totalDuration;
            report.slowestResource = slowest.url;
            report.largestResource = largest.url;
            report.totalResourcesSize = (totalSize / 1000);
            report.nonReportingResources = missingList.length;
            report.timeStamp = now.getTime();
            report.date = now.getDate() + "/" + now.getMonth() + "/" + now.getFullYear();
            report.time = now.getHours() + ":" + now.getMinutes() + ":" + now.getSeconds();
            report.errors = this.performance.evalConsoleErrors;


            //console.log(JSON.stringify(report));
            console.log('Elapsed load time: ' + pad(elapsed, 6) + 'ms');

            if(phantom.args.indexOf('csv') >= 0){
                this.printToFile(config,report,'loadreport','csv',phantom.args.indexOf('wipe') >= 0);
            }

            if(phantom.args.indexOf('json') >= 0){
                this.printToFile(config,report,'loadreport','json',phantom.args.indexOf('wipe') >= 0);
            }

            if(phantom.args.indexOf('junit') >= 0){
                this.printToFile(config,report,'loadreport','xml',phantom.args.indexOf('wipe') >= 0);
            }

        }


    },

    filmstrip: {
        onInitialized: function(page, config) {
            // console.log("onInitialized")
            this.screenshot(new Date().getTime(),page);
        },
        onLoadStarted: function (page, config) {
            // console.log("onLoadStarted")
            if (!this.performance.start) {
                this.performance.start = new Date().getTime();
            }
            this.screenshot(new Date().getTime(),page);
        },
        onResourceRequested: function (page, config, request) {
            // console.log("onResourceRequested")
            this.screenshot(new Date().getTime(),page);
        },
        onResourceReceived: function (page, config, response) {
            // console.log("onResourceReceived")
            this.screenshot(new Date().getTime(),page);
        },

        onLoadFinished: function (page, config, status) {
            // console.log("onLoadFinished")
            this.screenshot(new Date().getTime(),page);
        }
    },

    getFinalUrl: function (page) {
        return page.evaluate(function () {
            return document.location.toString();
        });
    },

    emitConfig: function (config, prefix) {
        console.log(prefix + 'Config:');
        for (key in config) {
            if (config[key].constructor === Object) {
                if (key===config.task) {
                    console.log(prefix + ' ' + key + ':');
                    for (key2 in config[key]) {
                        console.log(prefix + '  ' + key2 + ': ' + config[key][key2]);
                    }
                }
            } else {
                console.log(prefix + ' ' + key + ': ' + config[key]);
            }
        }
    },

    load: function (config, task, scope) {
        var page = WebPage.create(),
            pagetemp = WebPage.create(),
            event;    

        if (config.viewportSize) {
            var size = config.viewportSize
            page.viewportSize = size;
            page.clipRect = { left: 0, top: 0, width: size.width, height: size.height };
        }
        
        if (config.cookie){
            page.addCookie(config.cookie);
        }
        
        if (config.customHeaders) {
            page.customHeaders = config.customHeaders;
        }
        
        if (config.userAgent && config.userAgent != "default") {
            if (config.userAgentAliases[config.userAgent]) {
                config.userAgent = config.userAgentAliases[config.userAgent];
            }
            page.settings.userAgent = config.userAgent;
        }
        
        ['onInitialized', 'onLoadStarted', 'onResourceRequested', 'onResourceReceived']
            .forEach(function (event) {
            if (task[event]) {
                page[event] = function () {
                    var args = [page, config],
                        a, aL;
                    for (a = 0, aL = arguments.length; a < aL; a++) {
                        args.push(arguments[a]);
                    }
                    task[event].apply(scope, args);
                };

            }
        });
        if (task.onLoadFinished) {
            page.onLoadFinished = function (status) {
                if (config.wait) {
                    setTimeout(
                        function () {
                            task.onLoadFinished.call(scope, page, config, status);
                        },
                        config.wait
                    );
                } else {
                    task.onLoadFinished.call(scope, page, config, status);
                }
                phantom.exit();

                page = WebPage.create();
                doPageLoad();
            };
        } else {
            page.onLoadFinished = function (status) {
                phantom.exit();
            };
        }
        page.settings.localToRemoteUrlAccessEnabled = true;
        page.settings.webSecurityEnabled = false;
        page.onConsoleMessage = function (msg, lineNum, sourceId) {
            console.log('CONSOLE: ' + msg);
            if (msg.indexOf('jserror-') >= 0){
                loadreport.performance.evalConsoleErrors.push(msg.substring('jserror-'.length,msg.length));
            }else{
                if (msg.indexOf('loading-') >= 0){
                    loadreport.performance.evalConsole.loading = msg.substring('loading-'.length,msg.length);
                } else if (msg.indexOf('interactive-') >= 0){
                    loadreport.performance.evalConsole.interactive = msg.substring('interactive-'.length,msg.length);
                // } else if (msg.indexOf('complete-') >= 0){
                //     loadreport.performance.evalConsole.complete = msg.substring('complete-'.length,msg.length);
                } else if (msg.indexOf('onload-') >= 0){
                    loadreport.performance.evalConsole.onload = msg.substring('onload-'.length,msg.length);
                }
                //loadreport.performance.evalConsole.push(msg);
            }
        };

        page.onError = function (msg, trace) {
            var msgStack = ['ERROR: ' + msg];
            if (trace && trace.length) {
                msgStack.push('TRACE:');
                trace.forEach(function(t) {
                    msgStack.push(' -> ' + t.file + ': ' + t.line + (t.function ? ' (in function "' + t.function + '")' : ''));
                });
            }
            console.error(msgStack.join('\n'));
            
            trace.forEach(function(item) {
                loadreport.performance.evalConsoleErrors.push(msg + ':' + item.file + ':' + item.line);
            })
        };

        function doPageLoad(){
            setTimeout(function(){page.open(config.url}, config.cacheWait);
        }

        if(config.task == 'performancecache'){
            pagetemp.open(config.url,function(status) {
                if (status === 'success') {
                    pagetemp.close();
                    doPageLoad();
                }
            });
        }else{
            doPageLoad();
        }
    },

    /*worker: function(now,page){
        var currentTime = now - this.performance.start;
        var ths = this;


        if((currentTime) >= this.performance.count1){
            var worker = new Worker('./worker.js');
            worker.addEventListener('message', function (event) {
                //getting errors after 3rd thread with...
                //_this.workerTask.callback(event);
                //mycallback(event);
                console.log('message' + event.data);
            }, false);
            worker.postMessage(page);
            this.performance.count2++;
            this.performance.count1 = currentTime + (this.performance.count2 * 100);
        }
    },*/

    screenshot: function(now, page){
        var start = timerStart();
        var offsetTime = now - this.performance.start;
        console.log(offsetTime, this.performance.planTime)
        if( offsetTime >= this.performance.planTime ){
            this.performance.planTime =this.performance.lastTime + this.config.intervalTime;
            var shotPath = 'filmstrip/screenshot-' + offsetTime + '.png';
            //var ashot = page.renderBase64();
            page.render(shotPath);
            //subtract the time it took to render this image
            this.performance.timer = timerEnd(start) - this.performance.planTime;
            this.performance.lastTime = offsetTime;
        }
    },

    /**
     * Format test results as JUnit XML for CI
     * @see: http://www.junit.org/
     * @param {Array} tests the arrays containing the test results from testResults.
     * @return {String} the results as JUnit XML text
     */
    formatAsJUnit: function (keys, values) {
        var junitable = ['domReadystateLoading','domReadystateInteractive','windowOnload','elapsedLoadTime','numberOfResources','totalResourcesTime','totalResourcesSize','nonReportingResources'];
        var i, n = 0, key, value, suite,
            junit = [],
            suites = [];

        for (i = 0; i < keys.length; i++) {
            key = keys[i];

            if (junitable.indexOf(key) === -1) {
                continue;
            }
            value = values[i];
            // open test suite w/ summary
            suite = '  <testsuite name="' + key + '" tests="1">\n';
            suite += '    <testcase name="' + key + '" time="' + value + '"/>\n';
            suite +='  </testsuite>';
            suites.push(suite);
            n++;
        }

        // xml
        junit.push('<?xml version="1.0" encoding="UTF-8" ?>');

        // open test suites wrapper
        junit.push('<testsuites>');

        // concat test cases
        junit = junit.concat(suites);

        // close test suites wrapper
        junit.push('</testsuites>');

        return junit.join('\n');
    },

    printToFile: function(config,report,filename,extension,createNew) {
        var f, myfile,
            keys = [], values = [];
        for(var key in report)
        {
            if(report.hasOwnProperty(key))
            {
                keys.push(key);
                values.push(report[key]);
            }
        }
        if(phantom.args[3] && phantom.args[3] != 'wipe'){
            myfile = 'reports/' + filename + '-' + phantom.args[3] + '.' + extension;
        }else{
            myfile = 'reports/' + filename + '.' + extension;

        }

        if(!createNew && fs.exists(myfile)){
            //file exists so append line
            try{
                switch (extension) {
                    case 'json':
                        var phantomLog = [];
                        var tempLine = JSON.parse(fs.read(myfile));
                        if(Object.prototype.toString.call( tempLine ) === '[object Array]'){
                            phantomLog = tempLine;
                        }
                        phantomLog.push(report);
                        fs.remove(myfile);
                        f = fs.open(myfile, "w");
                        f.writeLine(JSON.stringify(phantomLog));
                        f.close();
                        break;
                    case 'xml':
                        console.log("cannot append report to xml file");
                        break;
                    default:
                        f = fs.open(myfile, "a");
                        f.writeLine(values);
                        f.close();
                        break;
                }
            } catch (e) {
                console.log("problem appending to file",e);
            }
        }else{
            if(fs.exists(myfile)){
                fs.remove(myfile);
            }
            //write the headers and first line
            try {
                f = fs.open(myfile, "w");
                switch (extension) {
                    case 'json':
                        f.writeLine(JSON.stringify(report));
                        break;
                    case 'xml':
                        f.writeLine(this.formatAsJUnit(keys, values));
                        break;
                    default:
                        f.writeLine(keys);
                        f.writeLine(values);
                        break;
                }
                f.close();
            } catch (e) {
                console.log("problem writing to file",e);
            }
        }
    }

};


function run(options){
    loadreport.performancecache = clone(loadreport.performance);
    loadreport.config = mergeConfig(options, options.configFile);
    var task = loadreport[loadreport.config.task];
    // console.log(JSON.stringify(this.config))
    loadreport.load(loadreport.config, task, loadreport);
}

var cliConfig = {};
if (!processArgs(cliConfig, [
    {
        name: 'url',
        def: 'http://google.com',
        req: true,
        desc: 'the URL of the site to load test'
    }, 
    {
        name: 'task',
        def: 'performance',
        req: false,
        desc: 'the task to perform',
        oneof: ['performance', 'performancecache', 'filmstrip']
    },
    {
        name: 'configFile',
        def: 'config.json',
        req: false,
        desc: 'a local configuration file of further loadreport settings'
    },
    {
        name: 'intervalTime',
        def: 50,
        req: false,
        desc: 'interval time of the screenshot',
    }
])) {
    return phantom.exit();
}

netsniff.start(cliConfig, function(){
    run(cliConfig);
});

