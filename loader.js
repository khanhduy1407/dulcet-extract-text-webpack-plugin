/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/
var loaderUtils = require("loader-utils");
var NodeTemplatePlugin = require("@dulcetjs/webpack/lib/node/NodeTemplatePlugin");
var NodeTargetPlugin = require("@dulcetjs/webpack/lib/node/NodeTargetPlugin");
var LibraryTemplatePlugin = require("@dulcetjs/webpack/lib/LibraryTemplatePlugin");
var SingleEntryPlugin = require("@dulcetjs/webpack/lib/SingleEntryPlugin");
var LimitChunkCountPlugin = require("@dulcetjs/webpack/lib/optimize/LimitChunkCountPlugin");
module.exports = function(source) {
	this.cacheable && this.cacheable();
	return source;
};
module.exports.pitch = function(request, preReq, data) {
	this.cacheable && this.cacheable();
	var query = loaderUtils.parseQuery(this.query);
	this.addDependency(this.resourcePath);
	// We already in child compiler, return empty bundle
	if(this[__dirname] === undefined) {
		throw new Error(
			'"dulcet-extract-text-webpack-plugin" loader is used without the corresponding plugin, ' +
			'refer to https://github.com/khanhduy1407/dulcet-extract-text-webpack-plugin for the usage example'
		);
	} else if(this[__dirname] === false) {
		return "";
	} else if(this[__dirname](null, query)) {
		if(query.omit) {
			this.loaderIndex += +query.omit + 1;
			request = request.split("!").slice(+query.omit).join("!");
		}
		if(query.remove) {
			var resultSource = "// removed by dulcet-extract-text-webpack-plugin";
		} else {
			var resultSource = undefined;
		}

		if(query.extract !== false) {
			var childFilename = __dirname + " " + request;
			var publicPath = typeof query.publicPath === "string" ? query.publicPath : this._compilation.outputOptions.publicPath
			var outputOptions = {
				filename: childFilename,
				publicPath: publicPath
			};
			var childCompiler = this._compilation.createChildCompiler("dulcet-extract-text-webpack-plugin", outputOptions);
			childCompiler.apply(new NodeTemplatePlugin(outputOptions));
			childCompiler.apply(new LibraryTemplatePlugin(null, "commonjs2"));
			childCompiler.apply(new NodeTargetPlugin());
			childCompiler.apply(new SingleEntryPlugin(this.context, "!!" + request));
			childCompiler.apply(new LimitChunkCountPlugin({ maxChunks: 1 }));
			var subCache = "subcache " + __dirname + " " + request;
			childCompiler.plugin("compilation", function(compilation) {
				if(compilation.cache) {
					if(!compilation.cache[subCache])
						compilation.cache[subCache] = {};
					compilation.cache = compilation.cache[subCache];
				}
			});
			// We set loaderContext[__dirname] = false to indicate we already in
			// a child compiler so we don't spawn another child compilers from there.
			childCompiler.plugin("this-compilation", function(compilation) {
				compilation.plugin("normal-module-loader", function(loaderContext, module) {
					loaderContext[__dirname] = false;
				});
			});
			var source;
			childCompiler.plugin("after-compile", function(compilation, callback) {
				source = compilation.assets[childFilename] && compilation.assets[childFilename].source();

				// Remove all chunk assets
				compilation.chunks.forEach(function(chunk) {
					chunk.files.forEach(function(file) {
						delete compilation.assets[file];
					});
				});

				callback();
			}.bind(this))
			var callback = this.async();
			childCompiler.runAsChild(function(err, entries, compilation) {
				if(err) return callback(err);

				compilation.fileDependencies.forEach(function(dep) {
					this.addDependency(dep);
				}, this);
				compilation.contextDependencies.forEach(function(dep) {
					this.addContextDependency(dep);
				}, this);
				if(!source) {
					return callback(new Error("Didn't get a result from child compiler"));
				}
				try {
					var text = this.exec(source, request);
					if(typeof text === "string")
						text = [[0, text]];
					text.forEach(function(item) {
						var id = item[0];
						compilation.modules.forEach(function(module) {
							if(module.id === id)
								item[0] = module.identifier();
						});
					});
					this[__dirname](text, query);
				} catch(e) {
					return callback(e);
				}
				if(resultSource)
					callback(null, resultSource);
				else
					callback();
			}.bind(this));
		} else {
			this[__dirname]("", query);
			return resultSource;
		}
	}
};
