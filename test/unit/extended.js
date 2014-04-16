var fs = require('fs'),
	uglify = require('../../uglify-js'),
	jsp = uglify.parser,
	nodeunit = require('nodeunit'),
	pro = uglify.uglify;

var tests = {};

tests.extract_tokens = function(test) {
	var tokens = uglify.utils.extract_tokens([
		'var obj = { foo: 1 };',
		'obj["bar"] = 2;',
		'obj.baz = "message";',
		'"/**/var a = { b: 1 }; "',
		'"var c = { d: 1 }; "'
	].join("\n"));
	test.deepEqual(tokens, ['foo', 'bar', 'baz', 'a', 'b']);
	test.done();
};

tests.make_tokenfile_info = function(test) {
	var code = [
		'var obj = { foo: 1 };',
		'obj["bar"] = 2;',
		'obj.baz = "message";',
		'"/**/var a = { b: 1 }; "',
		'"var c = { d: 1 }; "'
	].join("\n");

	var tokens = ['foo', '#bar', 'c # comment', ' ', 'a'].join();
	var actual_lines = uglify.utils.make_tokenfile_info(code, { tokens: tokens });
	var expected = [ '#b: length of token is less than 2', '#bar', 'a', 'baz', 'foo' ];
	test.deepEqual(actual_lines, expected);

	actual_lines = uglify.utils.make_tokenfile_info(code, { tokens: tokens, diff: true });
	expected = [ '+ #b: length of token is less than 2', '+ baz', '- c # comment' ];
	test.deepEqual(actual_lines, expected);

	// the case where there are no new tokens
	tokens = [ 'b', '#bar', 'a', 'baz', 'foo' ].join();
	actual_lines = uglify.utils.make_tokenfile_info(code, { tokens: tokens, diff: true });
	expected = [];
	test.deepEqual(actual_lines, expected);

	test.done();
};

tests.namespace = function(test) {
	var ast = jsp.parse([
		'var f = function(a) { var foo = {}; };',
		'var bar = {};',
		'function g() {}'
	].join('\n'));
	ast = pro.ast_mangle(ast, { toplevel: true, mangle_uniquely: true });
	test.equal(pro.gen_code(ast), 'function c(){}var a=function(d){var e={}};var b={}');
	test.done();
};

tests.ignore_eval = function(test) {
	var code = [
		'var foo = 1;',
		'if (DEBUG) eval("foo");'
	].join('\n');

	var ast = pro.ast_mangle(jsp.parse(code), { toplevel: true });
	test.equal(pro.gen_code(ast), 'var foo=1;if(DEBUG)eval("foo")');

	ast = pro.ast_mangle(jsp.parse(code), { toplevel: true, ignore_eval: true });
	test.equal(pro.gen_code(ast), 'var a=1;if(DEBUG)eval("foo")');
	test.done();
};

tests.ast_mangle_more = function(test) {
	var property_maps = ['foo:aa', 'bar:bb', 'baz:cc'];
	var vars_in_string = ['obj0', 'obj1'];
	var default_options = {
		toplevel: true,
		property_maps: property_maps,
		vars_in_string: vars_in_string
	};

	function create_options(additional_options) {
		var options = {};
		for (var option in default_options) {
			options[option] = default_options[option];
		}
		for (var option in additional_options) {
			options[option] = additional_options[option];
		}
		return options;
	};

	var testcases = [
		{
			code:     'var obj = { foo: 1 }; obj["bar"] = 2; obj.baz = 3;',
			expected: 'var a={aa:1};a["bb"]=2;a.cc=3',
			msg:      'specified property names should be mangled'
		},
		{
			code:     'var obj = { foo2: 1 }; obj["bar2"] = 2; obj.baz2 = 3;',
			expected: 'var a={foo2:1};a["bar2"]=2;a.baz2=3',
			msg:      'non-specified property names should not be mangled'
		},
		{
			code:     'var obj; "obj"; "foo"; "foo2";',
			expected: 'var a;"obj";"aa";"foo2"',
			msg:      'strings should be considered as property names'
		},
		{
			code:     'body+="/**/var o = { \'foo\': 1 }; o[\\"bar\\"] = 2; o.baz = 3; o[\'bar\'];"',
			expected: 'body+="var o = { \'aa\': 1 }; o[\\"bb\\"] = 2; o.cc = 3; o[\'bb\'];"',
			msg:      'specified property names in code strings should be mangled'
		},
		{
			code:     'body+="/**/var o = { \'foo2\': 1 }; o[\\"bar2\\"] = 2; o.baz2 = 3; o[\'bar2\']"',
			expected: 'body+="var o = { \'foo2\': 1 }; o[\\"bar2\\"] = 2; o.baz2 = 3; o[\'bar2\']"',
			msg:      'non-specified property names in code strings should not be mangled'
		},
		{
			code:     'body+="/**/var obj = { foo: 1, \'bar\': 2, \\"baz\\": 3 };"',
			expected: 'body+="var obj = { foo: 1, \'bb\': 2, \\"cc\\": 3 };"',
			//         only quoted names will be mangled
			//         because it is too difficult to mangle non-quoted names correctly
			msg:      'only quoted names will be mangled'
		},
		{
			code:     'var obj1, obj2, obj3;"/**/obj.foo; obj0, obj1; obj2; obj.obj3;"',
			expected: 'var a,b,c;"obj.aa; a, b; obj2; obj.obj3;"',
			msg:      'only registered tokens will be mangled'
		},
		{
			code:     'var obj1, obj2, obj3;"/**/obj.foo; obj0, obj1; obj2; obj.obj3;"',
			expected: 'var a,b,c;"obj.aa; d, a; obj2; obj.obj3;"',
			msg:      'only registered tokens will be mangled',
			additional_options: { mangle_uniquely: true }
		},
		{
			code:     'body+="/**/var a = obj0;"',
			expected: 'body+="var a = b;"',
			msg:      'mangled tokens should not conflict with existing variables'
		}
	];

	for (var i = 0; i < testcases.length; ++i) {
		var testcase = testcases[i];
		var options = create_options(testcase.additional_options);
		var ast = pro.ast_mangle(jsp.parse(testcase.code), options);
		test.equal(pro.gen_code(ast), testcase.expected, testcase.msg);
	}
	test.done();
};

tests.make_mapping = function(test) {
	var testcases = [
		{
			tokens:   ['foo', 'bar', 'baz'],
			mapping:  null,
			expected: ['bar:a', 'baz:b', 'foo:c'],
			msg:      'mapping is not specified'
		},
		{
			tokens:   ['foo', 'bar', 'baz'],
			mapping:  ['foo:a', 'baz:b'],
			expected: ['bar:c', 'baz:b', 'foo:a'],
			msg:      'mapping is specified partially'
		},
		{
			tokens:   ['foo', 'bar', 'baz'],
			mapping:  ['foo:a', 'bar:c', 'baz:b', 'qux:z'],
			expected: ['bar:c', 'baz:b', 'foo:a', 'qux:z'],
			msg:      'an extra token exists in mapping'
		}
	];
	for (var i = 0; i < testcases.length; ++i) {
		var testcase = testcases[i];
		var mapping = uglify.utils.make_mapping({
			tokens: testcase.tokens,
			mapping: testcase.mapping
		});
		test.deepEqual(mapping, testcase.expected, testcase.msg);
	}
	test.done();
};

tests.remove_statements = function(test) {
	var ast = jsp.parse([
		'function Log() {}',
		'Log();',
		'console.log(msg);',
		'console["log"](msg);',
		'console.foo.log(msg);',
		'console.warn(msg);',
		'window.console.log(msg);'
	].join('\n'));
	var remove_stmts = {
		'call': [
			'console.log',
			'console["foo"]["log"]',
			'Log'
		]
	};
	ast = pro.ast_mangle(ast);
	var actual = pro.gen_code(ast, { remove_statements: remove_stmts });
	var expected = 'function Log(){}console.warn(msg);window.console.log(msg)';
	test.equal(actual, expected, 'remove function calls');

	ast = jsp.parse([
		'if (develop) {',
		'} else if (develop.DEBUG) {',
		'} else if (develop["DEBUG"]) {',
		'} else if (develop == true){',
		'}'
	].join('\n'));
	remove_stmts = {
		'if': [
			'develop',
			'develop["DEBUG"]'
		]
	};
	ast = pro.ast_mangle(ast);
	actual = pro.gen_code(ast, { remove_statements: remove_stmts });
	expected = 'if(develop==true){}';
	test.equal(actual, expected, 'remove if statements');
	test.done();
};

module.exports = nodeunit.testCase(tests);
