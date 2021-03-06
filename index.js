/*
	MIT License http://www.opensource.org/licenses/mit-license.php
*/
var ConcatSource = require("@dulcetjs/webpack/lib/ConcatSource");
var Template = require("@dulcetjs/webpack/lib/Template");
var async = require("async");
var SourceNode = require("source-map").SourceNode;
var SourceMapConsumer = require("source-map").SourceMapConsumer;
var ModuleFilenameHelpers = require("@dulcetjs/webpack/lib/ModuleFilenameHelpers");
var ExtractedModule = require("./ExtractedModule");
var Chunk = require("@dulcetjs/webpack/lib/Chunk");
var OrderUndefinedError = require("./OrderUndefinedError");
var loaderUtils = require("loader-utils");

var nextId = 0;

function ExtractTextPlugin(id, filename, options) {
	if(typeof filename !== "string") {
		options = filename;
		filename = id;
		id = ++nextId;
	}
	if(!options) options = {};
	this.filename = filename;
	this.options = options;
	this.id = id;
}
module.exports = ExtractTextPlugin;

function mergeOptions(a, b) {
	if(!b) return a;
	Object.keys(b).forEach(function(key) {
		a[key] = b[key];
	});
	return a;
};

ExtractTextPlugin.loader = function(options) {
	return require.resolve("./loader") + (options ? "?" + JSON.stringify(options) : "");
};

ExtractTextPlugin.extract = function(before, loader, options) {
	if(typeof loader === "string") {
		return [
			ExtractTextPlugin.loader(mergeOptions({omit: before.split("!").length, extract: true, remove: true}, options)),
			before,
			loader
		].join("!");
	} else {
		options = loader;
		loader = before;
		return [
			ExtractTextPlugin.loader(mergeOptions({remove: true}, options)),
			loader
		].join("!");
	}
};

ExtractTextPlugin.prototype.applyAdditionalInformation = function(source, info) {
	if(info) {
		return new ConcatSource(
			"@media " + info[0] + " {",
			source,
			"}"
		);
	}
	return source;
};

ExtractTextPlugin.prototype.loader = function(options) {
	options = JSON.parse(JSON.stringify(options || {}));
	options.id = this.id;
	return ExtractTextPlugin.loader(options);
};

ExtractTextPlugin.prototype.extract = function(before, loader, options) {
	if(typeof loader === "string") {
		return [
			this.loader(mergeOptions({omit: before.split("!").length, extract: true, remove: true}, options)),
			before,
			loader
		].join("!");
	} else {
		options = loader;
		loader = before;
		return [
			this.loader(mergeOptions({remove: true}, options)),
			loader
		].join("!");
	}
};

ExtractTextPlugin.prototype.apply = function(compiler) {
	var options = this.options;
	compiler.plugin("this-compilation", function(compilation) {
		var extractCompilation = new ExtractTextPluginCompilation();
		compilation.plugin("normal-module-loader", function(loaderContext, module) {
			loaderContext[__dirname] = function(content, opt) {
				if(options.disable)
					return false;
				if(!Array.isArray(content) && content !== null)
					throw new Error("Exported value is not a string.");
				module.meta[__dirname] = {
					content: content,
					options: opt || {}
				};
				return options.allChunks || module.meta[__dirname + "/extract"];
			};
		}.bind(this));
		var contents;
		var filename = this.filename;
		var id = this.id;
		var extractedChunks, entryChunks, initialChunks;
		compilation.plugin("optimize", function() {
			entryChunks = compilation.chunks.filter(function(c) {
				return c.entry;
			});
			initialChunks = compilation.chunks.filter(function(c) {
				return c.initial;
			});
		}.bind(this));
		compilation.plugin("optimize-tree", function(chunks, modules, callback) {
			contents = [];
			extractedChunks = chunks.map(function(chunk) {
				return new Chunk();
			});
			chunks.forEach(function(chunk, i) {
				var extractedChunk = extractedChunks[i];
				extractedChunk.index = i;
				extractedChunk.originalChunk = chunk;
				extractedChunk.name = chunk.name;
				chunk.chunks.forEach(function(c) {
					extractedChunk.addChunk(extractedChunks[chunks.indexOf(c)]);
				});
				chunk.parents.forEach(function(c) {
					extractedChunk.addParent(extractedChunks[chunks.indexOf(c)]);
				});
			});
			entryChunks.forEach(function(chunk) {
				var idx = chunks.indexOf(chunk);
				if(idx < 0) return;
				var extractedChunk = extractedChunks[idx];
				extractedChunk.entry = true;
			});
			initialChunks.forEach(function(chunk) {
				var idx = chunks.indexOf(chunk);
				if(idx < 0) return;
				var extractedChunk = extractedChunks[idx];
				extractedChunk.initial = true;
			});
			async.forEach(chunks, function(chunk, callback) {
				var extractedChunk = extractedChunks[chunks.indexOf(chunk)];
				var shouldExtract = !!(options.allChunks || chunk.initial);
				async.forEach(chunk.modules.slice(), function(module, callback) {
					var meta = module.meta && module.meta[__dirname];
					if(meta && (!meta.options.id || meta.options.id === id)) {
						var wasExtracted = Array.isArray(meta.content);
						if(shouldExtract !== wasExtracted) {
							module.meta[__dirname + "/extract"] = shouldExtract
							compilation.rebuildModule(module, function(err) {
								if(err) {
									compilation.errors.push(err);
									return callback();
								}
								meta = module.meta[__dirname];
								if(!Array.isArray(meta.content)) {
									var err = new Error(module.identifier() + " doesn't export content");
									compilation.errors.push(err);
									return callback();
								}
								if(meta.content)
									extractCompilation.addResultToChunk(module.identifier(), meta.content, module, extractedChunk);
								callback();
							}.bind(this));
						} else {
							if(meta.content)
								extractCompilation.addResultToChunk(module.identifier(), meta.content, module, extractedChunk);
							callback();
						}
					} else callback();
				}.bind(this), function(err) {
					if(err) return callback(err);
					callback();
				}.bind(this));
			}.bind(this), function(err) {
				if(err) return callback(err);
				extractedChunks.forEach(function(extractedChunk) {
					if(extractedChunk.initial)
						this.mergeNonInitialChunks(extractedChunk);
				}, this);
				compilation.applyPlugins("optimize-extracted-chunks", extractedChunks);
				callback();
			}.bind(this));
		}.bind(this));
		compilation.plugin("additional-assets", function(callback) {
			var assetContents = {};
			extractedChunks.forEach(function(extractedChunk) {
				if(extractedChunk.modules.length) {
					extractedChunk.modules.sort(function(a, b) {
						var order = getOrder(a, b);
						if(isNaN(order)) {
							compilation.errors.push(new OrderUndefinedError(a.getOriginalModule()));
							compilation.errors.push(new OrderUndefinedError(b.getOriginalModule()));
						}
						if(order !== 0 && !isNaN(order))
							return order;
						var ai = a.identifier();
						var bi = b.identifier();
						if(ai < bi)
							return -1;
						if(ai > bi)
							return 1;
						return 0;
					});
					var chunk = extractedChunk.originalChunk;
					var source = this.renderExtractedChunk(extractedChunk);
					var file = compilation.getPath(filename, {
						chunk: chunk
					}).replace(/\[(?:(\w+):)?contenthash(?::([a-z]+\d*))?(?::(\d+))?\]/ig, function() {
						return loaderUtils.getHashDigest(source.source(), arguments[1], arguments[2], parseInt(arguments[3], 10));
					});
					compilation.assets[file] = source;
					chunk.files.push(file);
				}
			}, this);
			callback();
		}.bind(this));
	}.bind(this));
};

function ExtractTextPluginCompilation() {
	this.modulesByIdentifier = {};
}

ExtractTextPlugin.prototype.mergeNonInitialChunks = function(chunk, intoChunk, checkedChunks) {
	if(!intoChunk) {
		checkedChunks = [];
		chunk.chunks.forEach(function(c) {
			if(c.initial) return;
			this.mergeNonInitialChunks(c, chunk, checkedChunks);
		}, this);
	} else if(checkedChunks.indexOf(chunk) < 0) {
		checkedChunks.push(chunk);
		chunk.modules.slice().forEach(function(module) {
			chunk.removeModule(module);
			intoChunk.addModule(module);
			module.addChunk(intoChunk);
		});
		chunk.chunks.forEach(function(c) {
			if(c.initial) return;
			this.mergeNonInitialChunks(c, intoChunk, checkedChunks);
		}, this);
	}
};

ExtractTextPluginCompilation.prototype.addModule = function(identifier, originalModule, source, additionalInformation, sourceMap, prevModules) {
	if(!this.modulesByIdentifier[identifier])
		return this.modulesByIdentifier[identifier] = new ExtractedModule(identifier, originalModule, source, sourceMap, additionalInformation, prevModules);
	var m = this.modulesByIdentifier[identifier];
	m.addPrevModules(prevModules);
	return m;
};

ExtractTextPluginCompilation.prototype.addResultToChunk = function(identifier, result, originalModule, extractedChunk) {
	if(!Array.isArray(result)) {
		result = [[identifier, result]];
	}
	var counterMap = {};
	var prevModules = [];
	result.forEach(function(item) {
		var c = counterMap[item[0]];
		var i = item.slice();
		var module = this.addModule.call(this, item[0] + (c || ""), originalModule, item[1], item[2], item[3], prevModules.slice());
		extractedChunk.addModule(module);
		module.addChunk(extractedChunk);
		counterMap[item[0]] = (c || 0) + 1;
		prevModules.push(module);
	}, this);
};

ExtractTextPlugin.prototype.renderExtractedChunk = function(chunk) {
	var source = new ConcatSource();
	chunk.modules.forEach(function(module) {
		source.add(this.applyAdditionalInformation(module.source(), module.additionalInformation));
	}, this);
	return source;
};

function getOrder(a, b) {
	var bBeforeA = a.getPrevModules().indexOf(b) >= 0;
	var aBeforeB = b.getPrevModules().indexOf(a) >= 0;
	if(aBeforeB && bBeforeA)
		return NaN;
	if(bBeforeA)
		return 1;
	if(aBeforeB)
		return -1;
	return 0;
}
