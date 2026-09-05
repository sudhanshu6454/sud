<?php
/**
 * Site footer.
 *
 * @package marketing-mentalist
 */
?>
</main>

<footer class="mm-footer">
	<div class="mm-wrap mm-footer-top">
		<div>
			<div class="mm-footer-brand">
				<img src="<?php echo esc_url( MM_URI . '/assets/img/mark-dark.png' ); ?>" alt="<?php bloginfo( 'name' ); ?>" width="44" height="44" loading="lazy">
				<span style="font:700 22px/1 var(--font-display);letter-spacing:-.01em"><?php bloginfo( 'name' ); ?></span>
			</div>
			<p class="mm-footer-tag">The psychology behind marketing that works.</p>
		</div>
		<div class="mm-footer-col">
			<strong>Explore</strong>
			<?php
			if ( has_nav_menu( 'footer-explore' ) ) {
				wp_nav_menu( array( 'theme_location' => 'footer-explore', 'container' => 'ul', 'menu_class' => '', 'depth' => 1 ) );
			} else {
				echo '<ul>';
				foreach ( array( 'Campaigns' => get_post_type_archive_link( 'mm_campaign' ), 'Breakdowns' => get_post_type_archive_link( 'mm_breakdown' ), 'Brands' => get_post_type_archive_link( 'mm_brand' ), 'Agencies' => get_post_type_archive_link( 'mm_agency' ), 'News' => home_url( '/' ), 'Top lists' => get_post_type_archive_link( 'mm_list' ) ) as $label => $url ) {
					printf( '<li><a href="%s">%s</a></li>', esc_url( $url ), esc_html( $label ) );
				}
				echo '</ul>';
			}
			?>
		</div>
		<div class="mm-footer-col">
			<strong>Company</strong>
			<?php
			if ( has_nav_menu( 'footer-company' ) ) {
				wp_nav_menu( array( 'theme_location' => 'footer-company', 'container' => 'ul', 'menu_class' => '', 'depth' => 1 ) );
			} else {
				echo '<ul>';
				foreach ( array( 'about' => 'About', 'contact' => 'Contact', 'advertise' => 'Advertise', 'submit-campaign' => 'Submit campaign' ) as $slug => $label ) {
					$url = mm_page_link( $slug );
					if ( $url ) {
						printf( '<li><a href="%s">%s</a></li>', esc_url( $url ), esc_html( $label ) );
					}
				}
				echo '</ul>';
			}
			?>
		</div>
		<div class="mm-footer-col">
			<strong>Legal</strong>
			<?php
			if ( has_nav_menu( 'footer-legal' ) ) {
				wp_nav_menu( array( 'theme_location' => 'footer-legal', 'container' => 'ul', 'menu_class' => '', 'depth' => 1 ) );
			} else {
				echo '<ul>';
				foreach ( array( 'privacy-policy' => 'Privacy policy', 'terms' => 'Terms', 'editorial-policy' => 'Editorial policy', 'corrections-policy' => 'Corrections policy' ) as $slug => $label ) {
					$url = mm_page_link( $slug );
					if ( $url ) {
						printf( '<li><a href="%s">%s</a></li>', esc_url( $url ), esc_html( $label ) );
					}
				}
				echo '</ul>';
			}
			?>
		</div>
	</div>
	<div class="mm-wrap mm-footer-bottom">
		<span>© <?php echo esc_html( wp_date( 'Y' ) ); ?> <?php bloginfo( 'name' ); ?> · marketingmentalist.in</span>
		<div>
			<?php foreach ( mm_social_links() as $label => $url ) : ?>
				<a href="<?php echo esc_url( $url ); ?>" rel="me noopener" target="_blank"><?php echo esc_html( $label ); ?></a>
			<?php endforeach; ?>
		</div>
	</div>
</footer>

<?php if ( is_singular( array( 'mm_breakdown', 'post', 'mm_campaign' ) ) ) : ?>
<div class="mm-share-pill" id="mm-share-pill">
	<button type="button" data-mm-share data-title="<?php echo esc_attr( get_the_title() ); ?>" data-url="<?php echo esc_url( get_permalink() ); ?>" aria-label="Share">Share</button>
	<button type="button" data-mm-copy data-url="<?php echo esc_url( get_permalink() ); ?>" aria-label="Copy link">Copy link</button>
</div>
<?php endif; ?>

<?php wp_footer(); ?>
</body>
</html>
