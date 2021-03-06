/*
	MIT License http://www.opensource.org/licenses/mit-license.php
*/
var SourceMapSource = require("@dulcetjs/webpack/lib/SourceMapSource");
var RawSource = require("@dulcetjs/webpack/lib/RawSource");

function ExtractedModule(identifier, originalModule, source, sourceMap, addtitionalInformation, prevModules) {
	this._identifier = identifier;
	this._originalModule = originalModule;
	this._source = source;
	this._sourceMap = sourceMap;
	this._prevModules = prevModules;
	this.addtitionalInformation = addtitionalInformation;
	this.chunks = [];
}
module.exports = ExtractedModule;

ExtractedModule.prototype.addChunk = function(chunk) {
	var idx = this.chunks.indexOf(chunk);
	if(idx < 0)
		this.chunks.push(chunk);
};

ExtractedModule.prototype._removeAndDo = require("@dulcetjs/webpack/lib/removeAndDo");

ExtractedModule.prototype.removeChunk = function(chunk) {
	return this._removeAndDo("chunks", chunk, "removeModule");
};

ExtractedModule.prototype.rewriteChunkInReasons = function(oldChunk, newChunks) { };

ExtractedModule.prototype.identifier = function() {
	return this._identifier;
};

ExtractedModule.prototype.source = function() {
	if(this._sourceMap)
		return new SourceMapSource(this._source, null, this._sourceMap);
	else
		return new RawSource(this._source);
};

ExtractedModule.prototype.getOriginalModule = function() {
	return this._originalModule;
};

ExtractedModule.prototype.getPrevModules = function() {
	return this._prevModules;
}

ExtractedModule.prototype.addPrevModules = function(prevModules) {
	prevModules.forEach(function(m) {
		if(this._prevModules.indexOf(m) < 0)
			this._prevModules.push(m);
	}, this);
};
