<?php
/**
 * Runs the plugin's tests. Uses PHPUnit when it is installed (vendor/ or phpunit.phar), otherwise a
 * tiny built-in runner with the same assertion names, so `php tests/run-tests.php` always works.
 *   php tests/run-tests.php
 */
$root = dirname( __DIR__ );
if ( ! class_exists( 'PHPUnit\Framework\TestCase' ) ) {
	class TestCase {
		public int $asserts = 0;
		private function ok( bool $c, string $m ): void { $this->asserts++; if ( ! $c ) { throw new Exception( $m ); } }
		public function assertNull( $v, string $m = '' ) { $this->ok( $v === null, "$m expected null, got " . var_export( $v, true ) ); }
		public function assertNotNull( $v, string $m = '' ) { $this->ok( $v !== null, "$m expected an error, got null" ); }
		public function assertSame( $a, $b, string $m = '' ) { $this->ok( $a === $b, "$m expected " . var_export( $a, true ) . ' got ' . var_export( $b, true ) ); }
		public function assertNotEmpty( $v, string $m = '' ) { $this->ok( ! empty( $v ), "$m expected non-empty" ); }
		public function assertContains( $n, array $h, string $m = '' ) { $this->ok( in_array( $n, $h, true ), $m ?: "$n not in list" ); }
		public function assertStringContainsString( string $n, $h, string $m = '' ) { $this->ok( is_string( $h ) && str_contains( $h, $n ), "$m expected '$n' in " . var_export( $h, true ) ); }
		public function assertStringNotContainsString( string $n, $h, string $m = '' ) { $this->ok( ! is_string( $h ) || ! str_contains( $h, $n ), "$m did not expect '$n'" ); }
	}
} else { class_alias( 'PHPUnit\Framework\TestCase', 'TestCase' ); }
require __DIR__ . '/ValidateTest.php';
$t = new ValidateTest(); $fail = 0; $n = 0;
foreach ( get_class_methods( $t ) as $m ) {
	if ( ! str_starts_with( $m, 'test_' ) ) { continue; }
	$n++;
	try { $t->$m(); echo "  ok   $m\n"; } catch ( Throwable $e ) { $fail++; echo "  FAIL $m: {$e->getMessage()}\n"; }
}
echo "\nvalidation: $n tests, $fail failed\n";
echo "model equality vs pulse-model.js:\n";
passthru( PHP_BINARY . ' ' . escapeshellarg( __DIR__ . '/model-equality.php' ), $code );
exit( $fail || $code ? 1 : 0 );
