var d = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function(chunk) { d += chunk; });
process.stdin.on('end', function() {
  var ctx = JSON.parse(d);
  var s = ctx.financials.filter(function(c) {
    return c.per !== null && c.roe !== null && c.per <= 25 && c.roe >= 10;
  });
  console.log(JSON.stringify({ screened: s, screened_count: s.length }));
});
