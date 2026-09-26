<?php
/**
 * Site-wide switches under Appearance > Customize > Marketing Junkies.
 *
 * @package marketing-junkies
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'customize_register',
	static function ( WP_Customize_Manager $wpc ) {
		$wpc->add_section(
			'mj_options',
			array(
				'title'    => __( 'Marketing Junkies', 'marketing-junkies' ),
				'priority' => 30,
			)
		);

		$add = static function ( string $id, array $setting, array $control ) use ( $wpc ) {
			$wpc->add_setting( $id, $setting + array( 'type' => 'theme_mod' ) );
			$wpc->add_control( $id, $control + array( 'section' => 'mj_options' ) );
		};

		$add(
			'mj_ads_enabled',
			array(
				'default'           => true,
				'sanitize_callback' => static fn( $v ) => (bool) $v,
			),
			array(
				'type'        => 'checkbox',
				'label'       => __( 'Show ad units', 'marketing-junkies' ),
				'description' => __( 'Leaderboard, mobile banner, in-article, sidebar, newsletter sponsor and the in-feed sponsored card.', 'marketing-junkies' ),
			)
		);
		$add(
			'mj_ads_txt',
			array(
				'default'           => '',
				'sanitize_callback' => 'sanitize_textarea_field',
			),
			array(
				'type'        => 'textarea',
				'label'       => __( 'ads.txt', 'marketing-junkies' ),
				'description' => __( 'Served at /ads.txt. Leave empty to return 404.', 'marketing-junkies' ),
			)
		);
		$add(
			'mj_newsletter_action',
			array(
				'default'           => '',
				'sanitize_callback' => 'esc_url_raw',
			),
			array(
				'type'        => 'url',
				'label'       => __( 'Newsletter signup URL', 'marketing-junkies' ),
				'description' => __( 'Form action of your email provider (Mailchimp, Brevo, Buttondown...). Until it is set the signup box says "Coming soon".', 'marketing-junkies' ),
			)
		);
		$add(
			'mj_newsletter_field',
			array(
				'default'           => 'email',
				'sanitize_callback' => 'sanitize_key',
			),
			array(
				'type'  => 'text',
				'label' => __( 'Newsletter email field name', 'marketing-junkies' ),
			)
		);
		$add(
			'mj_ai_crawlers',
			array(
				'default'           => 'allow',
				'sanitize_callback' => static fn( $v ) => 'block' === $v ? 'block' : 'allow',
			),
			array(
				'type'        => 'radio',
				'label'       => __( 'AI crawlers (GPTBot, ClaudeBot, PerplexityBot...)', 'marketing-junkies' ),
				'description' => __( 'Written explicitly into robots.txt either way.', 'marketing-junkies' ),
				'choices'     => array(
					'allow' => __( 'Allow: be cited in AI answers', 'marketing-junkies' ),
					'block' => __( 'Block', 'marketing-junkies' ),
				),
			)
		);
		foreach ( array(
			'linkedin'  => 'LinkedIn',
			'x'         => 'X',
			'instagram' => 'Instagram',
			'telegram'  => 'Telegram',
		) as $key => $label ) {
			$add(
				"mj_social_{$key}",
				array(
					'default'           => '',
					'sanitize_callback' => 'esc_url_raw',
				),
				array(
					'type'  => 'url',
					/* translators: %s: social network name */
					'label' => sprintf( __( '%s URL', 'marketing-junkies' ), $label ),
				)
			);
		}
	}
);
