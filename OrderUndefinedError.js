/*
	MIT License http://www.opensource.org/licenses/mit-license.php
*/
function OrderUndefinedError(module) {
	Error.call(this);
	Error.captureStackTrace(this, OrderUndefinedError);
	this.name = "OrderUndefinedError";
	this.message = "Order in extracted chunk undefined";
	this.module = module;
}
module.exports = OrderUndefinedError;

OrderUndefinedError.prototype = Object.create(Error.prototype);
