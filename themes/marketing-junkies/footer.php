<?php
/**
 * Footer: monogram, blurb, sections, company, follow.
 *
 * @package marketing-junkies
 */
?>
</div><!-- #mj-content -->

<footer class="mj-footer">
	<div class="mj-wrap">
		<div>
			<img src="<?php echo esc_url( MJ_URI . '/assets/img/mj-monogram-dark.png' ); ?>" alt="<?php echo esc_attr( get_bloginfo( 'name' ) ); ?>" width="56" height="56" loading="lazy">
			<p><?php echo esc_html( get_theme_mod( 'mj_footer_blurb', 'Your daily fix of marketing, media and martech news. marketingjunkies.in' ) ); ?></p>
		</div>
		<div class="mj-footer-col">
			<strong><?php esc_html_e( 'Sections', 'marketing-junkies' ); ?></strong>
			<?php mj_nav_menu( 'footer-sections', 'mj-footer-list' ); ?>
		</div>
		<div class="mj-footer-col">
			<strong><?php esc_html_e( 'Company', 'marketing-junkies' ); ?></strong>
			<?php
			if ( has_nav_menu( 'footer-company' ) ) {
				mj_nav_menu( 'footer-company', 'mj-footer-list' );
			} else {
				echo '<ul class="mj-footer-list">';
				foreach ( array( 'about' => __( 'About', 'marketing-junkies' ), 'editorial-policy' => __( 'Editorial policy', 'marketing-junkies' ), 'advertise' => __( 'Advertise', 'marketing-junkies' ), 'contact' => __( 'Contact', 'marketing-junkies' ) ) as $slug => $label ) {
					$url = mj_page_link( $slug );
					if ( $url ) {
						printf( '<li><a href="%s">%s</a></li>', esc_url( $url ), esc_html( $label ) );
					}
				}
				printf( '<li><a href="%s">%s</a></li>', esc_url( get_feed_link() ), esc_html__( 'RSS', 'marketing-junkies' ) );
				echo '</ul>';
			}
			?>
		</div>
		<div class="mj-footer-col">
			<strong><?php esc_html_e( 'Follow', 'marketing-junkies' ); ?></strong>
			<ul class="mj-footer-list">
				<?php foreach ( mj_social_links() as $label => $url ) : ?>
					<li><a href="<?php echo esc_url( $url ); ?>" rel="me noopener" target="_blank"><?php echo esc_html( $label ); ?></a></li>
				<?php endforeach; ?>
				<li><a href="#newsletter"><?php esc_html_e( 'Newsletter', 'marketing-junkies' ); ?></a></li>
			</ul>
		</div>
	</div>
	<div class="mj-footer-bottom"><div class="mj-wrap">
		<span>© <?php echo esc_html( wp_date( 'Y' ) ); ?> <?php bloginfo( 'name' ); ?></span>
		<span><?php esc_html_e( 'Original coverage · every story links to its source', 'marketing-junkies' ); ?></span>
	</div></div>
</footer>
<?php wp_footer(); ?>
</body>
</html>
