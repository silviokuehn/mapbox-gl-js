// @flow

const compileExpression = require('../function/compile');
const {BooleanType} = require('../function/types');
const {typeOf} = require('../function/values');

export type FeatureFilter = (globalProperties: {+zoom?: number}, feature: VectorTileFeature) => boolean;

module.exports = createFilter;

/**
 * Given a filter expressed as nested arrays, return a new function
 * that evaluates whether a given feature (with a .properties or .tags property)
 * passes its test.
 *
 * @private
 * @param {Array} filter mapbox gl filter
 * @returns {Function} filter-evaluating function
 */
function createFilter(filter: any): FeatureFilter {
    if (!filter) {
        return () => true;
    }

    const expression = Array.isArray(filter) ? convertFilter(filter) : filter.expression;
    const compiled = compileExpression(expression, BooleanType);

    if (compiled.result === 'success') {
        return (g, f) => {
            try {
                return compiled.function(g, f);
            } catch (e) {
                return false;
            }
        };
    } else {
        throw new Error(compiled.errors.map(err => `${err.key}: ${err.message}`).join(', '));
    }
}

function convertFilter(filter: ?Array<any>): mixed {
    if (!filter) return true;
    const op = filter[0];
    if (filter.length <= 1) return (op !== 'any');
    const converted =
        op === '==' ? compileComparisonOp(filter[1], filter[2], '==') :
        op === '!=' ? compileComparisonOp(filter[1], filter[2], '!=') :
        op === '<' ||
        op === '>' ||
        op === '<=' ||
        op === '>=' ? compileComparisonOp(filter[1], filter[2], op) :
        op === 'any' ? compileDisjunctionOp(filter.slice(1)) :
        op === 'all' ? ['&&'].concat(filter.slice(1).map(convertFilter)) :
        op === 'none' ? ['&&'].concat(filter.slice(1).map(convertFilter).map(compileNegation)) :
        op === 'in' ? compileInOp(filter[1], filter.slice(2)) :
        op === '!in' ? compileNegation(compileInOp(filter[1], filter.slice(2))) :
        op === 'has' ? compileHasOp(filter[1]) :
        op === '!has' ? compileNegation(compileHasOp(filter[1])) :
        true;
    return converted;
}

function compilePropertyReference(property: string, type?: ?string) {
    if (property === '$type') return ['geometry-type'];
    const ref = property === '$id' ? ['id'] : ['get', property];
    return type ? [type, ref] : ref;
}

function compileComparisonOp(property: string, value: any, op: string) {
    const type = typeOf(value).kind;
    const untypedReference = compilePropertyReference(property);
    const typedReference = compilePropertyReference(property, typeof value);

    if (value === null) {
        const expression = [
            '&&',
            compileHasOp(property),
            ['==', ['typeof', untypedReference], 'Null']
        ];
        return op === '!=' ? ['!', expression] : expression;
    }

    if (op === '!=') {
        return [
            '||',
            ['!=', ['typeof', untypedReference], type],
            ['!=', typedReference, value]
        ];
    }

    return [
        '&&',
        ['==', ['typeof', untypedReference], type],
        [op, typedReference, value]
    ];
}

function compileDisjunctionOp(filters: Array<Array<any>>) {
    return ['||'].concat(filters.map(convertFilter));
}

function compileInOp(property: string, values: Array<any>) {
    if (values.length === 0) {
        return false;
    }

    const input = compilePropertyReference(property);
    return [
        '&&',
        compileHasOp(property),
        ["contains", input, ["array", ["literal", values]]]
    ];
}

function compileHasOp(property: string) {
    if (property === '$id') {
        return ['!=', ['typeof', ['id']], 'Null'];
    }

    if (property === '$type') {
        return true;
    }

    return ['has', property];
}

function compileNegation(filter: mixed) {
    return ['!', filter];
}

